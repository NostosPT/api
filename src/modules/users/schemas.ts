import { Type } from "typebox";
import type { Static } from "typebox";
import { EmailString, IdParams, PaginationQuery, PasswordString, RoleEnum, UserStatusEnum } from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

export const CreateUserBody = Type.Object(
	{
		email: EmailString,
		name: Type.String({ minLength: 1, maxLength: 120 }),
		password: PasswordString,
		role: RoleEnum,
	},
	StrictObject,
);

export type CreateUserBody = Static<typeof CreateUserBody>;

export const UpdateUserBody = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
		role: Type.Optional(RoleEnum),
		status: Type.Optional(UserStatusEnum),
	},
	StrictObject,
);

export type UpdateUserBody = Static<typeof UpdateUserBody>;

export { IdParams, PaginationQuery };
