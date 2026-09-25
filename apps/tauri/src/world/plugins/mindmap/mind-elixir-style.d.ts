/**
 * mind-elixir 样式副作用的模块声明。
 * 该包 exports './style' 指向 CSS 文件（dist/MindElixir.css），
 * TS 无内建声明 → vue-tsc TS2882；此处补声明。
 */
declare module 'mind-elixir/style'
