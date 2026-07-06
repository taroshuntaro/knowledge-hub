import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

// defaultSchema からの拡張は最小限に留める:
// - input: GFM タスクリストのチェックボックス表示のみ（checkbox + disabled + checked）
// ハイライトの span/class は sanitize の後段（rehype-highlight）が生成するため許可不要。
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'input'],
  attributes: {
    ...defaultSchema.attributes,
    // フェンスの言語クラスを明示的に許可（defaultSchema の内容に依存しない）
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    input: [['type', 'checkbox'], 'checked', ['disabled', true]],
  },
};

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], [rehypeHighlight, { detect: false }]]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
