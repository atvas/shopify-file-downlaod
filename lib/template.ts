export const TEMPLATE_NAMES: Record<string, string> = {
  "templates/index.json": "首页",
  "templates/product.json": "商品页",
  "templates/collection.json": "集合页",
  "templates/collections.json": "集合列表",
  "templates/page.json": "页面",
  "templates/cart.json": "购物车",
  "templates/blog.json": "博客",
  "templates/article.json": "文章",
  "templates/list-collections.json": "集合列表",
  "templates/search.json": "搜索页",
  "templates/404.json": "404 页面",
  "templates/password.json": "密码页",
}

export function templateLabel(key: string) {
  if (TEMPLATE_NAMES[key]) return TEMPLATE_NAMES[key]
  return key
    .replace(/^templates\//, "")
    .replace(/^sections\//, "section/")
    .replace(/\.json$/, "")
}

/** 触发浏览器保存文件 */
export function triggerSave(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}
