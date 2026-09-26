import { prisma } from "../db/prisma.js";
import type { AuditResult } from "@prisma/client";

export interface AuditEvent {
	actorId?: string;
	action: string;
	resourceType: string;
	resourceId: string;
	result: AuditResult;
	metadata?: Record<string, string | number | boolean | null> | null;
}

// Append-only security audit trail. Never pass passwords, raw tokens,
// secrets, or authentication headers in metadata.
export async function logAudit(event: AuditEvent): Promise<void> {
	await prisma.auditLog.create({
		data: {
			actorId: event.actorId,
			action: event.action,
			resourceType: event.resourceType,
			resourceId: event.resourceId,
			result: event.result,
			metadata: event.metadata ?? undefined,
		},
	});
}
