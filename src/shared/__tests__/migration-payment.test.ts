import { describe, expect, test } from "bun:test";
import { hashFolderSelection } from "../migration-payment";

describe("hashFolderSelection", () => {
	test("order independent", () => {
		const a = hashFolderSelection(["INBOX", "Sent"]);
		const b = hashFolderSelection(["Sent", "INBOX"]);
		expect(a).toBe(b);
	});

	test("changes when selection changes", () => {
		const a = hashFolderSelection(["INBOX"]);
		const b = hashFolderSelection(["INBOX", "Archive"]);
		expect(a).not.toBe(b);
	});
});
