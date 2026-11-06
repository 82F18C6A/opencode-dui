// 阶段 0 的 renderer 只是占位：主进程直接加载官方 web UI
const el = document.querySelector('#app')
if (el) el.textContent = 'stage 0 placeholder'
