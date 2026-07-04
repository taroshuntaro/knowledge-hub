import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(12, 'パスワードは12文字以上で入力してください')
  .max(200);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const inviteSchema = z.object({ email: z.string().email() });
export const acceptInvitationSchema = z.object({
  displayName: z.string().min(1).max(50),
  password: passwordSchema,
});
export const passwordResetRequestSchema = z.object({ email: z.string().email() });
export const passwordResetConfirmSchema = z.object({ password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50),
  bio: z.string().max(2000),
});
export const updateUserByAdminSchema = z
  .object({
    role: z.enum(['member', 'admin']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, {
    message: '変更内容を指定してください',
  });
