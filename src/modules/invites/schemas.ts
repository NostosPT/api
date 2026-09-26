import { Type } from "typebox";
import type { Static } from "typebox";
import { EmailString, IdParams, PaginationQuery, RoleEnum } from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

export const CreateInviteBody = Type.Object(
	{
		email: EmailString,
		role: RoleEnum,
	},
	StrictObject,
);

export type CreateInviteBody = Static<typeof CreateInviteBody>;

export { IdParams, PaginationQuery };
