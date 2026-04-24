# EPUB Maker

一个用 Markdown 写书、一键导出 EPUB 的本地 Web 服务。

## 功能特性

- **分栏编辑**：左边 Markdown，右边实时预览，所见即所得
- **多书籍管理**：支持创建、切换、删除多本书
- **章节管理**：支持多章节、Part 分组，拖拽排序
- **图片处理**：支持粘贴图片自动转 base64，也支持本地上传
- **代码高亮**：使用 highlight.js，代码块语法高亮
- **脚注支持**：使用 `*[1]: 内容` 语法，生成 EPUB 脚注
- **元数据设置**：支持设置书名、作者、上传封面
- **自动保存**：编辑内容每 2 秒自动保存
- **一键导出**：点击按钮自动下载 EPUB 文件

## 技术栈

- **后端**：Node.js + Express
- **前端**：Vue 3 (CDN) + markdown-it + highlight.js
- **EPUB 生成**：adm-zip
- **部署**：npm 安装后直接运行

## 安装使用

```bash
# 克隆项目
git clone https://github.com/njxisang/epub-maker.git
cd epub-maker

# 安装依赖
npm install

# 启动服务
npm start
```

服务启动后访问 http://localhost:3000

## 数据存储

默认存储在 `~/.epub-maker/` 目录：

```
~/.epub-maker/
├── books.json                    # 书籍列表索引
└── books/
    └── [book-id]/
        ├── meta.json             # 元数据
        ├── chapters/
        │   ├── chapter-1.md
        │   └── ...
        └── images/
            ├── cover.jpg
            └── ...
```

## 项目结构

```
epub-maker/
├── server.js          # Express 服务器
├── package.json
└── public/
    ├── index.html     # 主页面
    ├── style.css
    └── app.js         # 前端逻辑
```

## API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/books` | 获取书籍列表 |
| POST | `/api/books` | 新建书籍 |
| GET | `/api/books/:id` | 获取某书信息 |
| PUT | `/api/books/:id` | 更新元数据 |
| DELETE | `/api/books/:id` | 删除书籍 |
| GET | `/api/books/:id/chapters` | 获取章节列表 |
| POST | `/api/books/:id/chapters` | 新增章节 |
| PUT | `/api/books/:id/chapters/:chapterId` | 更新章节 |
| DELETE | `/api/books/:id/chapters/:chapterId` | 删除章节 |
| PUT | `/api/books/:id/chapters/reorder` | 批量更新章节顺序 |
| POST | `/api/books/:id/upload` | 上传图片 |
| GET | `/api/books/:id/export` | 导出 EPUB |

## Markdown 语法

- H1 作为章节标题
- 代码块使用 triple backticks，指定语言：` ```javascript `
- 表格使用标准 Markdown 表格语法
- 脚注使用 `*[1]: 脚注内容` 语法
- 图片粘贴自动转为 base64，或使用 `[图片描述](images/xxx.jpg)` 引用本地图片
