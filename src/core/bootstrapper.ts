import { performance } from "node:perf_hooks";
import { createApp } from "../app.js";
import { loadConfig } from "../config/index.js";
import { disconnectPrisma } from "../db/prisma.js";
import * as logger from "../logging/logger.js";
import { startMonitoring } from "../monitoring/monitor.js";
import { HttpServer } from "./httpServer.js";
import { ShutdownManager } from "./shutdown.js";

export class Bootstrapper {
	public static async boot(): Promise<void> {
		const totalStart = performance.now();

		logger.info("Starting API..",);

		ShutdownManager.registerProcessListeners();

		const config = await this.runStep(
			"Configuration",
			() => loadConfig(),
		);

		const app = await this.runStep(
			"Application initialization",
			() => createApp(),
		);

		const httpServer = new HttpServer(app);

		await this.runStep(
			`HTTP server listening on ${config.env.HOST}:${config.env.PORT}`,
			() => httpServer.start(),
		);

		const monitor = await this.runStep(
			"Health monitoring",
			() => startMonitoring(),
		);

		// Handlers run in order: the monitor flushes buffered check results
		// before the Prisma connection closes.
		ShutdownManager.register(() => httpServer.stop());
		ShutdownManager.register(() => monitor?.stop());
		ShutdownManager.register(() => disconnectPrisma());

		const totalDuration = Math.round(performance.now() - totalStart);

		logger.info(`API ready in ${totalDuration}ms`);
	}


	private static async runStep<T>(stepName: string, stepFn: () => Promise<T> | T): Promise<T> {
		const start = performance.now();

		try {
			const result = await stepFn();
			const duration = Math.round(performance.now() - start);

			logger.info(`${this.formatStep(stepName, duration)}`);

			return result;
		}
		catch (error) {
			const duration = Math.round(performance.now() - start);

			logger.error(`${this.formatStep(stepName, duration)} FAILED: ${error instanceof Error ? error.message : String(error)}`);

			throw error;
		}
	}

	private static formatStep(stepName: string, durationMs: number): string {
		const width = 42;
		const dots = ".".repeat(Math.max(1, width - stepName.length));

		return `${stepName} ${dots} ${durationMs}ms`;
	}
}