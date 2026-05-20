import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDirectory } from "../../db/database";

const PREFIX = "enc:v1:";
const HMAC_PREFIX = "hmac:v1:";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

let key: Buffer | null = null;
let keyDataDir: string | null = null;

function getKey(): Buffer {
	const dataDir = getDataDirectory();
	if (key && keyDataDir === dataDir) return key;

	const dir = join(dataDir, "vault");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const saltPath = join(dir, ".metadata-salt");
	let salt: Buffer;
	if (existsSync(saltPath)) {
		salt = readFileSync(saltPath);
	} else {
		salt = randomBytes(16);
		writeFileSync(saltPath, salt, { mode: 0o600 });
	}

	key = scryptSync(`${process.platform}-${dataDir}-metadata`, salt, KEY_LENGTH);
	keyDataDir = dataDir;
	return key;
}

export function isEncryptedString(value: string | null | undefined): boolean {
	return Boolean(value?.startsWith(PREFIX));
}

export function encryptString(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	if (isEncryptedString(value)) return value;

	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGORITHM, getKey(), iv);
	const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptString(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	if (!isEncryptedString(value)) return value;

	const payload = value.slice(PREFIX.length);
	const [ivHex, tagHex, dataHex] = payload.split(":");
	if (!ivHex || !tagHex || !dataHex) return null;

	const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
	decipher.setAuthTag(Buffer.from(tagHex, "hex"));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(dataHex, "hex")),
		decipher.final(),
	]);
	return decrypted.toString("utf8");
}

export function hashString(scope: string, value: string): string {
	const digest = createHmac("sha256", getKey())
		.update(scope)
		.update("\0")
		.update(value)
		.digest("hex");
	return `${HMAC_PREFIX}${digest}`;
}
