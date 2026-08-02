// 检查 WebView2 页面状态
const TARGET = 'http://localhost:9222/json/list'
async function main() {
  try {
    const list = await (await fetch(TARGET)).json()
    console.log('pages:', JSON.stringify(list.map(p => ({ title: p.title, url: p.url, type: p.type }))))
  } catch (e) {
    console.log('ERR:', String(e))
  }
}
main()
