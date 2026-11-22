// Point this at the main VVeChat service when the panel runs on its own domain.
// 默认留空 —— 控制台跟主服务同源部署时(主站 /control 下),
// 相对路径本身就指向同一个服务。写死远程地址会让本地部署全打到线上。
window.VVECHAT_API_BASE = '';
