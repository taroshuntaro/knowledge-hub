import { ne } from 'drizzle-orm';
import { users } from '../db/schema';

// 「pending（未クレーム）行を一般側に見せない」述語の一元化（article-visibility.ts と同じ役割）。
// pending 行は事前登録された従業員名簿そのものなので、名簿・公開プロフィール・メンション候補
// などユーザーを列挙・参照するクエリでは必ずこれを組み合わせる（漏れると未入社者の氏名が
// 一般メンバーに露出する）。
export const claimedUserWhere = () => ne(users.authProvider, 'pending');
