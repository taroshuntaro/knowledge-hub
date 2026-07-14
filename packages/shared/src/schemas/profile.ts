import { z } from 'zod';

export const HIRE_YEAR_MIN = 1950;
/** 内定者の事前登録を許容するため上限は「現在年 + 1」。parse 時点の年で評価する */
export const hireYearMax = () => new Date().getFullYear() + 1;

export const hireYearSchema = z
  .number()
  .int()
  .min(HIRE_YEAR_MIN)
  .refine((y) => y <= hireYearMax(), { message: '入社年が大きすぎます' });

const masterNameSchema = z.string().trim().min(1, '名称を入力してください').max(50);

export const createMasterSchema = z.object({ name: masterNameSchema });
export const updateMasterSchema = z
  .object({
    name: masterNameSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => v.name !== undefined || v.sortOrder !== undefined, {
    message: '変更内容を指定してください',
  });
