import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	createCipheriv,
	createHmac,
	generateKeyPairSync,
	pbkdf2Sync,
	randomBytes,
	randomUUID,
} from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Use only disposable local containers; never connect this test to a real vault.
const cliImage = process.env.CLI_IMAGE;
const serverImage = process.env.VAULTWARDEN_IMAGE;
assert.ok(
	cliImage && serverImage,
	"CLI_IMAGE and VAULTWARDEN_IMAGE are required",
);
const owner = `bw-contract-${randomUUID()}`;
const server = `${owner}-server`;
const client = `${owner}-client`;
const managed = `${owner}-managed`;
const password = randomBytes(32).toString("base64url");
const email = "smoke@example.com";
let stage = "resource setup";
const containers = [];
let networkCreated = false;
const scratch = mkdtempSync(join(tmpdir(), `${owner}-`));
const certificatePath = join(scratch, "contract.crt");
const privateKeyPath = join(scratch, "contract.key");
let certificate;

async function docker(args, { input, env = {}, timeout = 120_000 } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", args, {
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
			timeout,
			killSignal: "SIGKILL",
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (data) => {
			stdout += data;
		});
		child.stderr.setEncoding("utf8").on("data", (data) => {
			stderr += data;
		});
		child.stdin.on("error", () => {});
		child.on("error", () =>
			reject(new Error(`${stage}: docker could not execute`)),
		);
		child.on("close", (code, signal) => {
			if (code === 0) return resolve(stdout.trim());
			const reason = /KeyIdBackfillError/.test(stderr + stdout)
				? "KeyIdBackfillError (CLI/server incompatibility)"
				: `docker exit ${code ?? signal}`;
			const infrastructureError = [
				"network",
				"create",
				"start",
				"cp",
				"port",
			].includes(args[0])
				? stderr.trim()
				: "";
			reject(
				new Error(
					`${stage}: ${reason}${infrastructureError ? `; ${infrastructureError}` : ""}`,
				),
			);
		});
		child.stdin.end(input);
	});
}

async function startContainer(name, args, files = []) {
	// Record ownership before launch so timeout/failure paths still remove it.
	containers.push(name);
	await docker([
		"create",
		"--name",
		name,
		"--label",
		`bw.contract=${owner}`,
		...args,
	]);
	for (const path of files) {
		await docker(["cp", path, `${name}:/tmp/${path.split(/[\\/]/).pop()}`]);
	}
	await docker(["start", name]);
}

async function request(base, path, options = {}) {
	if (base.startsWith("https:")) {
		return new Promise((resolve, reject) => {
			const req = httpsRequest(
				`${base}${path}`,
				{
					method: options.method ?? "GET",
					headers: options.headers,
					ca: certificate,
					signal: AbortSignal.timeout(10_000),
				},
				(response) => {
					let body = "";
					response.setEncoding("utf8").on("data", (data) => {
						body += data;
					});
					response.on("error", reject);
					response.on("end", () => {
						if (response.statusCode < 200 || response.statusCode >= 300) {
							return reject(
								new Error(`${stage}: HTTP ${response.statusCode} at ${path}`),
							);
						}
						try {
							resolve(JSON.parse(body));
						} catch {
							reject(new Error(`${stage}: invalid JSON response`));
						}
					});
				},
			);
			req.on("error", reject);
			req.end(options.body);
		});
	}
	const response = await fetch(`${base}${path}`, {
		...options,
		signal: AbortSignal.timeout(10_000),
	});
	assert.ok(response.ok, `${stage}: HTTP ${response.status} at ${path}`);
	return response.json();
}

async function waitForHttp(base, path, container, validate) {
	const deadline = Date.now() + 60_000;
	let lastStatus = "no HTTP response";
	while (Date.now() < deadline) {
		const running = await docker([
			"inspect",
			"--format",
			"{{.State.Running}}",
			container,
		]);
		if (running !== "true") {
			const logs = await docker(["logs", container]);
			const reason = logs.includes("KeyIdBackfillError")
				? "KeyIdBackfillError"
				: "container exited";
			throw new Error(`${stage}: ${reason}`);
		}
		try {
			const body = await request(base, path);
			lastStatus = `HTTP 2xx; CLI status=${body?.data?.template?.status ?? "missing"}`;
			if (validate(body)) return;
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			const cause = error.cause;
			const causeCode =
				cause instanceof Error && "code" in cause
					? `; cause=${String(cause.code)}`
					: "";
			lastStatus = `${error.message}${causeCode}`;
		}
		await delay(500);
	}
	throw new Error(
		`${stage}: readiness deadline exceeded for ${base}${path} (${lastStatus})`,
	);
}

async function publishedUrl(container, port, protocol = "http") {
	const mapping = await docker(["port", container, `${port}/tcp`]);
	assert.match(mapping, /^127\.0\.0\.1:\d+$/);
	return `${protocol}://${mapping}`;
}

// Bitwarden's legacy registration format: PBKDF2 master key, HKDF-expand
// enc/mac halves, and authenticated AES-CBC cipher strings. The real CLI
// must decrypt both the account keys and a created item to accept the fixture.
function encrypt(value, key) {
	const iv = randomBytes(16);
	const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
	const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
	const mac = createHmac("sha256", key.subarray(32))
		.update(iv)
		.update(encrypted)
		.digest();
	return `2.${[iv, encrypted, mac].map((part) => part.toString("base64")).join("|")}`;
}

function registration() {
	const iterations = 600_000;
	const masterKey = pbkdf2Sync(password, email, iterations, 32, "sha256");
	const expand = (info) =>
		createHmac("sha256", masterKey)
			.update(info)
			.update(Buffer.from([1]))
			.digest();
	const stretched = Buffer.concat([expand("enc"), expand("mac")]);
	const userKey = randomBytes(64);
	const pair = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "der" },
		privateKeyEncoding: { type: "pkcs8", format: "der" },
	});
	return {
		email,
		name: "Compatibility test",
		masterPasswordHash: pbkdf2Sync(
			masterKey,
			password,
			1,
			32,
			"sha256",
		).toString("base64"),
		key: encrypt(userKey, stretched),
		keys: {
			publicKey: pair.publicKey.toString("base64"),
			encryptedPrivateKey: encrypt(pair.privateKey, userKey),
		},
		kdf: 0,
		kdfIterations: iterations,
	};
}

async function main() {
	console.log(`Testing ${cliImage} against ${serverImage}; owner=${owner}`);
	stage = "temporary TLS certificate";
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-sha256",
			"-days",
			"1",
			"-subj",
			"/CN=127.0.0.1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
			"-addext",
			"basicConstraints=critical,CA:TRUE",
			"-keyout",
			privateKeyPath,
			"-out",
			certificatePath,
		],
		{ stdio: "pipe", timeout: 30_000 },
	);
	certificate = readFileSync(certificatePath);
	stage = "resource setup";
	await docker(["network", "create", "--label", `bw.contract=${owner}`, owner]);
	networkCreated = true;
	await startContainer(
		server,
		[
			"--network",
			owner,
			"--publish",
			"127.0.0.1::443",
			"--publish",
			"127.0.0.1::8087",
			"--tmpfs",
			"/data:rw,nosuid,size=128m",
			"--env",
			"SIGNUPS_ALLOWED=true",
			"--env",
			"SIGNUPS_VERIFY=false",
			"--env",
			"LOGIN_RATELIMIT_MAX_BURST=100",
			"--env",
			"ROCKET_PORT=443",
			"--env",
			'ROCKET_TLS={certs="/tmp/contract.crt",key="/tmp/contract.key"}',
			serverImage,
		],
		[certificatePath, privateKeyPath],
	);
	const serverUrl = await publishedUrl(server, 443, "https");
	stage = "Vaultwarden readiness";
	await waitForHttp(serverUrl, "/alive", server, () => true);

	stage = "fresh account registration";
	const verificationToken = await request(
		serverUrl,
		"/identity/accounts/register/send-verification-email",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({ email, name: "Compatibility test" }),
		},
	);
	assert.equal(typeof verificationToken, "string");
	await request(serverUrl, "/identity/accounts/register/finish", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...registration(),
			emailVerificationToken: verificationToken,
		}),
	});

	await startContainer(
		client,
		[
			"--network",
			`container:${server}`,
			"--tmpfs",
			"/bw:rw,uid=1000,gid=1000,mode=0700",
			"--env",
			"NODE_EXTRA_CA_CERTS=/tmp/contract.crt",
			"--env",
			"SSL_CERT_FILE=/tmp/contract.crt",
			"--entrypoint",
			"/bin/sh",
			cliImage,
			"-c",
			"exec sleep 900",
		],
		[certificatePath],
	);
	const bw = (args, options = {}) =>
		docker(
			[
				"exec",
				"-i",
				"--env",
				"BW_PASSWORD",
				"--env",
				"BW_SESSION",
				client,
				"bw",
				...args,
			],
			{
				...options,
				env: { BW_PASSWORD: password, BW_SESSION: session },
			},
		);
	let session = "";
	stage = "CLI version";
	console.log(`CLI version: ${await bw(["--version"])}`);
	await bw(["config", "server", "https://127.0.0.1"]);
	stage = "CLI login";
	session = await bw(["login", email, "--passwordenv", "BW_PASSWORD", "--raw"]);
	assert.ok(session, "login must return a session");
	console.log("PASS: fresh username/password login");
	stage = "CLI lock/unlock";
	await bw(["lock"]);
	session = await bw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"]);
	assert.ok(session, "unlock must return a session");
	assert.equal(JSON.parse(await bw(["status"])).status, "unlocked");
	console.log("PASS: lock and password unlock");

	stage = "encrypted item round trip";
	const note = `synthetic-${randomUUID()}`;
	const item = {
		type: 2,
		name: "Compatibility fixture",
		notes: note,
		secureNote: { type: 0 },
	};
	const created = JSON.parse(
		await bw(["create", "item"], {
			input: Buffer.from(JSON.stringify(item)).toString("base64"),
		}),
	);
	assert.ok(created.id, "create must return an item id");
	assert.equal(created.notes, note);
	await bw(["sync", "--force"]);
	assert.equal(JSON.parse(await bw(["get", "item", created.id])).notes, note);
	console.log("PASS: create, sync and decrypt an item");

	stage = "managed entrypoint login and serve";
	await startContainer(
		managed,
		[
			"--network",
			`container:${server}`,
			"--tmpfs",
			"/bw:rw,uid=1000,gid=1000,mode=0700",
			"--env",
			"BW_HOST=https://127.0.0.1",
			"--env",
			"NODE_EXTRA_CA_CERTS=/tmp/contract.crt",
			"--env",
			"SSL_CERT_FILE=/tmp/contract.crt",
			"--env",
			`BW_USER=${email}`,
			"--env",
			"BW_PASSWORD",
			cliImage,
		],
		[certificatePath],
	);
	const managedUrl = await publishedUrl(server, 8087);
	await waitForHttp(
		managedUrl,
		"/status",
		managed,
		(body) => body.data?.template?.status === "unlocked",
	);
	const served = await request(managedUrl, `/object/item/${created.id}`, {
		headers: { Host: "bitwarden-cli.external-secrets.svc.cluster.local:8087" },
	});
	assert.equal(served.data.notes, note);
	console.log(
		"PASS: managed serve and item read with a Kubernetes service Host header",
	);
}

try {
	// Docker's --env BW_PASSWORD reads this generated value, never a real credential.
	process.env.BW_PASSWORD = password;
	await main();
} catch (error) {
	console.error(`FAIL: ${error instanceof Error ? error.message : stage}`);
	process.exitCode = 1;
} finally {
	stage = "resource cleanup";
	for (const name of containers.reverse()) {
		try {
			await docker(["rm", "--force", "--volumes", name]);
		} catch {
			console.error(`FAIL: cleanup of ${name}`);
			process.exitCode = 1;
		}
	}
	if (networkCreated) {
		try {
			await docker(["network", "rm", owner]);
		} catch {
			console.error(`FAIL: cleanup of ${owner}`);
			process.exitCode = 1;
		}
	}
	rmSync(scratch, { recursive: true, force: true });
}
