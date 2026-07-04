import { z } from 'zod';

export const tagNameSchema = z.string().trim().min(1).max(30);

export const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(200_000),
  categoryId: z.string().uuid().nullable().optional(),
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

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  sortOrder: z.number().int().optional(),
});

export const categoryDeleteSchema = z.object({
  reassignToId: z.string().uuid().nullable().optional(),
});
