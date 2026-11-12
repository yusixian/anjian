/** Explicit semantic pairs. IDs are public links: preserve them when editing headings. */
/** @type {Record<string, Record<string, {zh: string, en: string}>>} */
export const docAnchorMap = {
  '': {
    start: { zh: '从你的场景开始', en: 'start-with-your-situation' },
    features: { zh: '全部功能', en: 'features' },
    data: { zh: '数据在哪里', en: 'where-your-data-lives' },
  },
  'local': {
    install: { zh: '安装与启动', en: 'install-and-start' },
    state: { zh: '作品和服务状态', en: 'artifacts-and-service-state' },
    devices: { zh: '让其他设备打开', en: 'open-from-another-device' },
    update: { zh: '更新案间', en: 'update-anjian' },
  },
  'agent': {
    skills: { zh: '读取内置-skill', en: 'read-the-built-in-skill' },
    entry: { zh: '配置项目入口', en: 'configure-a-project-entry-point' },
    feedback: { zh: '一轮反馈怎么处理', en: 'process-a-round-of-feedback' },
    events: { zh: '事件与自动处理', en: 'events-and-automation' },
    handover: { zh: '换一个-agent-接手', en: 'hand-over-to-another-agent' },
  },
  'remote-cli': {
    install: { zh: '安装与授权', en: 'install-and-authorize' },
    link: { zh: '绑定作品项目', en: 'link-an-artifact-project' },
    transfer: { zh: '上传与拉取', en: 'upload-and-pull' },
    devices: { zh: '查看与撤销设备', en: 'review-and-revoke-devices' },
    connection: { zh: '连接问题', en: 'connection-problems' },
  },
  'first-artifact': {
    agent: { zh: '用-agent-创建', en: 'create-with-an-agent' },
    html: { zh: '手动创建-html', en: 'create-html-manually' },
    type: { zh: '选择作品类型', en: 'choose-an-artifact-type' },
  },
  'documents': {
    edit: { zh: '阅读与编辑', en: 'read-and-edit' },
    comment: { zh: '在文字上批注', en: 'comment-on-text' },
    history: { zh: '历史对比', en: 'compare-history' },
    files: { zh: '文档源文件', en: 'document-source-files' },
  },
  'html': {
    resources: { zh: '页面与资源', en: 'pages-and-resources' },
    isolation: { zh: '隔离预览', en: 'isolated-previews' },
    debug: { zh: '调试与检查', en: 'debug-and-check' },
  },
  'artboards': {
    browse: { zh: '浏览与检查', en: 'browse-and-inspect' },
    comment: { zh: '批注与方案选择', en: 'comments-and-option-selection' },
    interactions: { zh: '交互与参数', en: 'interactions-and-parameters' },
    files: { zh: '给-agent-的文件约定', en: 'file-conventions-for-agents' },
    public: { zh: '公开画板', en: 'public-artboards' },
  },
  'library': {
    find: { zh: '查找作品', en: 'find-artifacts' },
    organize: { zh: '批量整理', en: 'organize-in-bulk' },
    restore: { zh: '恢复与永久删除', en: 'restore-and-permanently-delete' },
    copies: { zh: '本机与服务器副本', en: 'local-and-server-copies' },
  },
  'sharing': {
    create: { zh: '创建公开链接', en: 'create-a-public-link' },
    visitors: { zh: '朋友能做什么', en: 'what-visitors-can-do' },
    revoke: { zh: '更新和收回', en: 'update-or-revoke-a-share' },
    network: { zh: '网络与容量', en: 'network-and-capacity' },
  },
  'members': {
    sharing: { zh: '选择分享方式', en: 'choose-how-to-share' },
    invite: { zh: '管理员创建邀请', en: 'administrator-create-an-invitation' },
    accept: { zh: '朋友接受邀请并开始使用', en: 'friend-accept-and-start' },
    quota: { zh: '调整额度与暂停访问', en: 'adjust-quotas-and-suspend-access' },
    problems: { zh: '邀请打不开', en: 'invitation-problems' },
  },
  'storage': {
    quota: { zh: '共享额度', en: 'shared-quotas' },
    s3: { zh: '配置共享或个人-s3', en: 'configure-shared-or-personal-s3' },
    migrate: { zh: '迁移与启用', en: 'migrate-and-enable' },
    recovery: { zh: '失败与恢复', en: 'failure-and-recovery' },
    disk: { zh: '服务器磁盘', en: 'server-disks' },
    backup: { zh: '备份范围', en: 'what-to-back-up' },
  },
  'self-hosting': {
    prepare: { zh: '部署前准备', en: 'prepare-for-deployment' },
    origins: { zh: '两个来源', en: 'two-origins' },
    docker: { zh: 'docker-compose', en: 'docker-compose' },
    dokploy: { zh: 'dokploy', en: 'dokploy' },
    github: { zh: 'github-登录与邀请', en: 'github-sign-in-and-invitations' },
    checks: { zh: '部署后检查', en: 'check-after-deployment' },
  },
  'use-cases': {
    feedback: { zh: '1-在画板上指出问题', en: '1-point-out-problems-on-the-artboard' },
    edit: {
      zh: '2-回到会话让-agent-读取并修改',
      en: '2-return-to-the-conversation-and-request-edits',
    },
    review: {
      zh: '3-查看新版再决定下一步',
      en: '3-review-the-new-version-and-decide-what-comes-next',
    },
  },
  'faq': {
    empty: { zh: '作品库为什么是空的', en: 'why-is-my-library-empty' },
    link: { zh: '朋友打不开我的链接', en: 'why-cant-my-friend-open-the-link' },
    stale: { zh: '为什么公开页面不是最新内容', en: 'why-is-the-public-page-out-of-date' },
    agent: {
      zh: '为什么评论没有自动让-agent-工作',
      en: 'why-didnt-a-comment-automatically-start-my-agent',
    },
    conflict: {
      zh: 'push-或-pull-冲突怎么办',
      en: 'what-should-i-do-about-a-push-or-pull-conflict',
    },
    unsaved: { zh: '文档显示未保存怎么办', en: 'what-if-a-document-says-it-is-unsaved' },
    deleted: {
      zh: '已删除的作品为什么不能再-push',
      en: 'why-cant-i-push-a-deleted-artifact-again',
    },
    s3: { zh: '配置-s3-后能删除服务器文件吗', en: 'can-i-delete-server-files-after-setting-up-s3' },
    report: { zh: '如何反馈问题', en: 'how-do-i-report-a-problem' },
  },
  'about': {
    origins: { zh: '项目来源', en: 'project-origins' },
    licenses: { zh: '许可证', en: 'licenses' },
    maintenance: { zh: '维护与更新', en: 'maintenance-and-updates' },
  },
};
