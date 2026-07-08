// email の正準形（canonical form）を 1 箇所で定義する。ユーザーの同一性は email で
// 決まるため、保存も照合もすべてこの関数を通す。ここを変えれば全経路の正規化が揃う
// （各サービスに trim().toLowerCase() を直書きして片方だけズレる事故を防ぐ）。
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
