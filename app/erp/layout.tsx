// ERP Root Layout — 仅提供 HTML shell，所有业务布局在 (dashboard)/layout.tsx 中
// 这样做是因为 (dashboard) 是一个 route group，其 layout 专门处理 /erp/* 路由的 Sidebar 渲染
export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
