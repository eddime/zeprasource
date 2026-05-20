import { randomUUID } from "node:crypto";
import type { MailboxCredentials } from "../../../shared/types";
import { getDatabase } from "../../db/database";
import {
	createCredentialRef,
	credentialStore,
} from "../credentials/credential-store";
import { decryptString, encryptString } from "../crypto/local-secrets";

export type MailboxRole = "source" | "destination";

type StoredProfile = {
	id: string;
	role: string;
	provider: string;
	email: string;
	host: string;
	port: number;
	secure: number;
	auth_method: string;
	username: string | null;
	credential_ref: string;
};

function persistSecret(credentials: MailboxCredentials): string {
	const ref = createCredentialRef(credentials.email);
	credentialStore.store(ref, credentials.password ?? "");
	return ref;
}

function loadCredentialsFromProfile(row: StoredProfile): MailboxCredentials | null {
	const secret = credentialStore.retrieve(row.credential_ref);
	if (secret === null) return null;
	const email = decryptString(row.email);
	const host = decryptString(row.host);
	if (!email || !host) return null;

	return {
		provider: row.provider as MailboxCredentials["provider"],
		email,
		host,
		port: row.port,
		secure: Boolean(row.secure),
		authMethod: row.auth_method as MailboxCredentials["authMethod"],
		username: decryptString(row.username) ?? undefined,
		password: secret,
	};
}

export function saveMailboxProfile(
	role: MailboxRole,
	credentials: MailboxCredentials,
): { profileId: string } {
	const db = getDatabase();
	const credentialRef = persistSecret(credentials);
	const profileId = randomUUID();

	const existing = db
		.query("SELECT credential_ref FROM mailbox_profiles WHERE role = ?")
		.all(role) as Array<{ credential_ref: string }>;
	for (const row of existing) {
		credentialStore.delete(row.credential_ref);
	}
	db.prepare("DELETE FROM mailbox_profiles WHERE role = ?").run(role);

	db.prepare(
		`INSERT INTO mailbox_profiles (
      id, role, provider, email, host, port, secure, auth_method, username, credential_ref, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
	).run(
		profileId,
		role,
		credentials.provider,
		encryptString(credentials.email),
		encryptString(credentials.host),
		credentials.port,
		credentials.secure ? 1 : 0,
		credentials.authMethod,
		encryptString(credentials.username ?? null),
		credentialRef,
	);

	return { profileId };
}

export function loadMailboxCredentialsByRole(
	role: MailboxRole,
): MailboxCredentials | null {
	const db = getDatabase();
	const row = db
		.query(
			`SELECT * FROM mailbox_profiles WHERE role = ? ORDER BY updated_at DESC LIMIT 1`,
		)
		.get(role) as StoredProfile | null;
	if (!row) return null;
	return loadCredentialsFromProfile(row);
}

export function loadMailboxProfileForDisplay(
	role: MailboxRole,
): MailboxCredentials | null {
	const credentials = loadMailboxCredentialsByRole(role);
	if (!credentials) return null;
	return { ...credentials, password: undefined };
}
