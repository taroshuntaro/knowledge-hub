import { z } from 'zod';
import { REACTION_EMOJIS } from '../constants';

export const createCommentSchema = z.object({
  bodyMd: z.string().trim().min(1).max(5000),
  parentId: z.string().uuid().optional(),
});

export const updateCommentSchema = z.object({
  bodyMd: z.string().trim().min(1).max(5000),
});

export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});
