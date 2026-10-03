import type { FastifyInstance } from "fastify";
import { AppError } from "../errors/appError.js";
import * as logger from "../logging/logger.js";

interface FastifyLikeError {
	message?: string;
	code?: string;
	statusCode?: number;
	validation?: Array<{
		instancePath?: string;
		message?: string;
	}>;
}

interface ValidationIssue {
	field: string;
	message: string;
}

interface ErrorResponse {
	error: {
		code: string;
		statusCode: number;
		message: string;
		requestId: string;
		details?: ValidationIssue[];
	};
}

function isErrorObject(error: unknown): error is FastifyLikeError {
	return typeof error === "object" && error !== null;
}

function getStatusCode(error: unknown): number {
	if (error instanceof AppError) {
		return error.statusCode;
	}

	if (
		isErrorObject(error) &&
		typeof error.statusCode === "number" &&
		error.statusCode >= 400 &&
		error.statusCode < 600
	) {
		return error.statusCode;
	}

	return 500;
}

function getErrorCode(
	error: unknown,
	statusCode: number,
): string {
	if (error instanceof AppError) {
		return error.code;
	}

	if (isErrorObject(error)) {
		switch (error.code) {
			case "FST_ERR_CTP_INVALID_JSON_BODY":
				return "INVALID_JSON";

			case "FST_ERR_CTP_BODY_TOO_LARGE":
				return "PAYLOAD_TOO_LARGE";

			case "FST_ERR_VALIDATION":
				return "VALIDATION_ERROR";
		}
	}

	switch (statusCode) {
		case 404:
			return "NOT_FOUND";

		case 429:
			return "RATE_LIMIT_EXCEEDED";

		default:
			return statusCode >= 500
				? "INTERNAL_SERVER_ERROR"
				: "BAD_REQUEST";
	}
}

function getValidationDetails(error: unknown): ValidationIssue[] | undefined {
	if (!isErrorObject(error) || error.code !== "FST_ERR_VALIDATION") {
		return undefined;
	}

	if (!Array.isArray(error.validation)) {
		return [];
	}

	return error.validation.map((issue) => ({
		field: issue.instancePath && issue.instancePath !== "" ? issue.instancePath : "(body)",
		message: issue.message ?? "Invalid value",
	}));
}

function getErrorMessage(error: unknown, statusCode: number): string {
	if (error instanceof AppError) {
		return error.message;
	}

	if (statusCode >= 500) {
		return "Internal server error";
	}

	if (isErrorObject(error)) {
		switch (error.code) {
			case "FST_ERR_CTP_INVALID_JSON_BODY":
				return "Invalid JSON payload";

			case "FST_ERR_CTP_BODY_TOO_LARGE":
				return "Request payload is too large";

			default:
				if (typeof error.message === "string") {
					return error.message;
				}
		}
	}

	return "Request failed";
}

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
	app.setNotFoundHandler((request, reply) => {
		const response: ErrorResponse = {
			error: {
				code: "NOT_FOUND",
				statusCode: 404,
				message: `Route ${request.method}:${request.url} not found`,
				requestId: request.id,
			},
		};

		return reply.status(404).send(response);
	});

	app.	setErrorHandler((error, request, reply) => {
		const statusCode = getStatusCode(error);
		const code = getErrorCode(error, statusCode);
		const message = getErrorMessage(error, statusCode);
		const details = getValidationDetails(error);

		const summary = `Request failed with status ${statusCode} and code ${code} for request ${request.method} ${request.url} with requestId ${request.id}`;

		// 5xx responses hide the cause from the client, so the original error
		// (message, stack, Prisma code/meta) is logged server-side under `err`,
		// which pino serializes and the shared redaction paths still cover.
		if (statusCode >= 500) {
			logger.error(summary, { err: error, requestId: request.id });
		}
		else {
			logger.error(summary);
		}

		const response: ErrorResponse = {
			error: {
				code,
				statusCode,
				message,
				requestId: request.id,
				...(details === undefined ? {} : { details }),
			},
		};

		return reply.status(statusCode).send(response);
	});
}