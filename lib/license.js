/**
 * 授权标识
 * ========
 *
 * 这不是用来防破解的——JS 在本地跑，任何校验都能被删。
 *
 * 它的作用是「水印」：每一份发出去的包，这个值都不一样。
 * 万一哪天在别人的仓库里看见这套代码，翻一下 LICENSE_ID 就知道是谁传的。
 *
 * 打包时由 make_release.py 改写这两个值，源码里永远是 dev-000。
 */
export const LICENSE_ID = 'dev-000'
export const LICENSED_TO = '本地开发'
