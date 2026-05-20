import nodemailer from "nodemailer";
import type { MailboxCredentials } from "../../../shared/types";

type EtherealAccount = Awaited<ReturnType<typeof nodemailer.createTestAccount>>;

function toCredentials(account: EtherealAccount): MailboxCredentials {
	return {
		provider: "generic",
		email: account.user,
		host: account.imap.host,
		port: account.imap.port,
		secure: account.imap.secure,
		authMethod: "password",
		username: account.user,
		password: account.pass,
	};
}

/** Two disposable IMAP accounts on ethereal.email (internet required, no Docker). */
export async function createEtherealTestMailboxes(): Promise<{
	source: MailboxCredentials;
	destination: MailboxCredentials;
}> {
	const [sourceAccount, destAccount] = await Promise.all([
		nodemailer.createTestAccount(),
		nodemailer.createTestAccount(),
	]);
	return {
		source: toCredentials(sourceAccount),
		destination: toCredentials(destAccount),
	};
}

export async function seedEtherealInbox(credentials: MailboxCredentials): Promise<void> {
	const transport = nodemailer.createTransport({
		host: "smtp.ethereal.email",
		port: 587,
		secure: false,
		auth: {
			user: credentials.username ?? credentials.email,
			pass: credentials.password ?? "",
		},
	});
	await transport.sendMail({
		from: credentials.email,
		to: credentials.email,
		subject: `Zepra test ${Date.now()}`,
		text: "Cloud test message for migration",
		messageId: `<zepra-ethereal-${Date.now()}@test>`,
	});
	await transport.close();
}
