"use client";

/**
 * 根级兜底错误边界：接管 root layout 级别的崩溃（error.tsx 也失效时）。
 * 必须自带 html/body；用内联样式，不依赖任何外部资源是否可加载。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "24px",
          fontFamily: "system-ui, sans-serif",
          background: "#fff",
          color: "#111",
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "18px" }}>应用出现严重错误</h2>
        <p
          style={{
            margin: 0,
            maxWidth: "420px",
            fontSize: "13px",
            color: "#666",
            wordBreak: "break-all",
          }}
        >
          {error.message || "发生未知错误"}
        </p>
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            刷新页面
          </button>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
