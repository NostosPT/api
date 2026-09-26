import { Type } from "typebox";
import type { Static } from "typebox";
import { EmailString, PasswordString } from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

export const LoginBody = Type.Object(
	{
		email: EmailString,
		password: Type.String({ minLength: 1, maxLength: 256 }),
	},
	StrictObject,
);

export type LoginBody = Static<typeof LoginBody>;

export const AcceptInviteBody = Type.Object(
	{
		token: Type.String({ minLength: 1, maxLength: 256 }),
		name: Type.String({ minLength: 1, maxLength: 120 }),
		password: PasswordString,
	},
	StrictObject,
);

export type AcceptInviteBody = Static<typeof AcceptInviteBody>;
