import { logger } from "../../utils/logger";
import {
	checkpointInterruptedMigrations,
	loadMigrationResumePayload,
	pauseMigrationForShutdown,
} from "./migration-resume";
import { assertMigrationResumeLicense } from "../stripe/migration-payment-entitlements";
import { isUserPausedMigration } from "../../db/migration-repository";
import {
	enqueueMigration,
	getActiveMigrationIds,
	MAX_CONCURRENT_MIGRATIONS,
	pauseMigration,
	type ProgressEmitter,
} from "./migration-engine";

let resumeStarted = false;

/** Resume all interrupted migrations after app launch (up to concurrency limit). */
export function resumeInterruptedMigrations(emit: ProgressEmitter): void {
	if (resumeStarted) return;
	resumeStarted = true;

	void (async () => {
		const candidates = checkpointInterruptedMigrations();
		if (candidates.length === 0) return;

		for (const migrationId of candidates) {
			if (isUserPausedMigration(migrationId)) {
				logger.info(
					"migration",
					`Auto-resume skipped for ${migrationId} — paused by user`,
				);
				continue;
			}
			if (getActiveMigrationIds().includes(migrationId)) continue;
			if (getActiveMigrationIds().length >= MAX_CONCURRENT_MIGRATIONS) {
				logger.info(
					"migration",
					`Auto-resume deferred for ${migrationId} — at concurrency limit`,
				);
				continue;
			}

			const payload = loadMigrationResumePayload(migrationId);
			if (!payload) {
				logger.warn("migration", `Auto-resume skipped — no payload for ${migrationId}`);
				continue;
			}

			const folderPaths = payload.folderMappings
				.filter((m) => m.selected)
				.map((m) => m.sourcePath);

			logger.info("migration", `Auto-resuming migration ${migrationId}`);
			try {
				await assertMigrationResumeLicense(migrationId, folderPaths);
				await enqueueMigration(
					{
						resumeMigrationId: migrationId,
						source: payload.source,
						destination: payload.destination,
						folderMappings: payload.folderMappings,
					},
					emit,
				);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				logger.error("migration", `Auto-resume failed for ${migrationId}`, msg);
			}
		}
	})();
}

export function pauseAllMigrationsForShutdown(): void {
	for (const id of getActiveMigrationIds()) {
		pauseMigration(id);
		pauseMigrationForShutdown(id);
	}
}
