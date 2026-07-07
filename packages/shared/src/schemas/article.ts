import { z } from 'zod';

export const tagNameSchema = z.string().trim().min(1).max(30);

export const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(200_000),
  categoryId: z.string().uuid().nullable().optional(),
  heroImageUploadId: z.string().uuid().nullable().optional(),
  tags: z.array(tagNameSchema).max(10),
});

export const updateArticleSchema = createArticleSchema.extend({
  expectedUpdatedAt: z.string().datetime(),
});

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  parentId: z.string().uuid().nullable().optional(),
});

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => v.name !== undefined || v.sortOrder !== undefined, {
    message: 'name か sortOrder のいずれかを指定してください',
  });

export const categoryDeleteSchema = z.object({
  reassignToId: z.string().uuid().nullable().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  categoryId: z.string().uuid().optional(),
  tag: tagNameSchema.optional(),
  authorId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
