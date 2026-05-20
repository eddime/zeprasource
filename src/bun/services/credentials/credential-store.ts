import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDirectory } from "../../db/database";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

/**
 * Local credential vault. Values are encrypted at rest with a machine-derived key.
 * OS keychain integration can replace storeSecret/retrieveSecret without API changes.
 */
class CredentialStore {
	private key: Buffer | null = null;
	private keyDataDir: string | null = null;

	private getVaultDir(): string {
		const dir = join(getDataDirectory(), "vault");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		return dir;
	}

	private getVaultPath(): string {
		return join(this.getVaultDir(), "credentials.json");
	}

	private getKey(): Buffer {
		const dataDir = getDataDirectory();
		if (this.key && this.keyDataDir === dataDir) return this.key;

		const saltPath = join(this.getVaultDir(), ".salt");
		let salt: Buffer;
		if (existsSync(saltPath)) {
			salt = readFileSync(saltPath);
		} else {
			salt = randomBytes(16);
			writeFileSync(saltPath, salt);
		}

		const machineId = `${process.platform}-${dataDir}`;
		this.key = scryptSync(machineId, salt, KEY_LENGTH);
		this.keyDataDir = dataDir;
		return this.key;
	}

	private readVault(): Record<string, string> {
		const vaultPath = this.getVaultPath();
		if (!existsSync(vaultPath)) return {};
		try {
			return JSON.parse(readFileSync(vaultPath, "utf8")) as Record<string, string>;
		} catch {
			return {};
		}
	}

	private writeVault(data: Record<string, string>): void {
		writeFileSync(this.getVaultPath(), JSON.stringify(data, null, 2), { mode: 0o600 });
	}

	store(ref: string, secret: string): void {
		const iv = randomBytes(12);
		const cipher = createCipheriv(ALGORITHM, this.getKey(), iv);
		const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
		const tag = cipher.getAuthTag();
		const payload = `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;

		const vault = this.readVault();
		vault[ref] = payload;
		this.writeVault(vault);
	}

	retrieve(ref: string): string | null {
		const vault = this.readVault();
		const payload = vault[ref];
		if (!payload) return null;

		const [ivHex, tagHex, dataHex] = payload.split(":");
		if (!ivHex || !tagHex || !dataHex) return null;

		const decipher = createDecipheriv(
			ALGORITHM,
			this.getKey(),
			Buffer.from(ivHex, "hex"),
		);
		decipher.setAuthTag(Buffer.from(tagHex, "hex"));
		const decrypted = Buffer.concat([
			decipher.update(Buffer.from(dataHex, "hex")),
			decipher.final(),
		]);
		return decrypted.toString("utf8");
	}

	delete(ref: string): void {
		const vault = this.readVault();
		delete vault[ref];
		this.writeVault(vault);
	}
}

export const credentialStore = new CredentialStore();

export function createCredentialRef(prefix: string): string {
	return `${prefix}_${randomBytes(8).toString("hex")}`;
}
