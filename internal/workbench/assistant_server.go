package workbench

import "github.com/modelcontextprotocol/go-sdk/mcp"

// 内置助手的工具集：只开放给助手进程，不暴露给对外 MCP。
// 作品工具（list/get/create/update/generate/open）立即反映在界面上；删除、下载模型、改设置
// 只能经 propose_action 提议，由用户在确认卡片上执行；不提供导入导出。
var assistantTools = []string{
	"list_works", "get_work", "create_work", "update_work", "generate_work", "get_generation_status", "inspect_audio", "add_timeline_audio",
	"plan_melody", "cover_melody", "transform_melody",
	"open_work", "open_page", "list_models", "list_voices", "list_characters", "save_character", "status",
	"get_app_status", "get_recent_errors", "remember_preference", "forget_preference", "propose_action",
}

// newAssistantServer 构建只给内置助手的 MCP server：status/list_models/list_voices 与对外 MCP 共用定义，
// 作品工具只在这里注册。
func (w *Workbench) newAssistantServer() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "yovoice", Version: "1.0.0"}, nil)
	w.registerStatusTool(server)
	w.registerListModelsTool(server)
	w.registerListVoicesTool(server)
	mcp.AddTool(server, &mcp.Tool{Name: "list_works", Description: "列出作品（id、类型、标题、更新时间），可按类型过滤。类型：text（语音）、story（故事配音）、music（音乐）、sfx（音效）、score（编曲）。"}, w.listWorksTool)
	mcp.AddTool(server, &mcp.Tool{Name: "get_work", Description: "读取一个作品的完整可编辑内容：台词或风格、歌词、角色与音色分配、模型与参数、乐谱、时间线轨道摘要（序号、id、名称、锁定与末尾时间）等。修改作品前先调用。"}, w.getWorkTool)
	mcp.AddTool(server, &mcp.Tool{Name: "create_work", Description: "按类型新建作品并返回 id，默认让界面随即打开它（open=false 则只在后台创建、不切换界面）。新作品为空内容，随后用 update_work 填写。只想建声音角色时不要新建作品，用 save_character。"}, w.createWorkTool)
	mcp.AddTool(server, &mcp.Tool{Name: "update_work", Description: "按字段补丁修改作品：标题、台词/文本、歌词与纯音乐、演唱语言、故事配音的角色台词、乐谱（与写谱同一套校验）、YuE2 旋律谱 abc；右侧检查器里的全部声音设置与高级参数（模型、音色、声音设计描述、情绪、语速、温度、modelOptions 等）放在 settings；characterId 套用声音库角色；故事配音的每个角色用 speakerSettings。返回修改后的摘要。"}, w.updateWorkTool)
	mcp.AddTool(server, &mcp.Tool{Name: "list_characters", Description: "列出声音库里的角色（id、名称、模型、参考音色、声音设计描述）。给作品或故事角色套用角色前先调用。"}, w.listCharactersTool)
	mcp.AddTool(server, &mcp.Tool{Name: "save_character", Description: "新建或修改声音库里的角色（声音配置：模型、参考音色、声音设计描述、全部参数）。新建可用 fromWork 以某个作品当前的声音设置为起点，再用 settings 改动；修改已有角色传 id。不会改动任何作品，也不会切换界面。删除角色走 propose_action。"}, w.saveCharacterTool)
	mcp.AddTool(server, &mcp.Tool{Name: "generate_work", Description: "对一个作品发起生成（语音、音乐、音效或编曲渲染），立即返回；生成前先用 list_models 确认模型已安装。进度与结果用 get_generation_status 查询。YuE2 作品选的是按旋律谱生成却还没有谱时会被拒绝：先 plan_melody 写谱、填入作品，等用户看过试听过并同意后再生成。"}, w.generateWorkTool)
	mcp.AddTool(server, &mcp.Tool{Name: "get_generation_status", Description: "查询作品当前的生成进度与最近一次生成的结果（时长与是否完成）。"}, w.getGenerationStatusTool)
	mcp.AddTool(server, &mcp.Tool{Name: "add_timeline_audio", Description: "把一个完整的生成版本作为独立素材加入故事配音时间线。id 是目标 story 作品，generationId 是来源版本；track 可填 get_work 返回的轨道名称或 1 起始序号，留空新建“音效”轨；start 是秒数，留空追加到该轨末尾。锁定轨道不能修改。"}, w.addTimelineAudioTool)
	mcp.AddTool(server, &mcp.Tool{Name: "open_work", Description: "让界面打开某个作品。"}, w.openWorkTool)
	mcp.AddTool(server, &mcp.Tool{Name: "open_page", Description: "让界面切换页面：text（语音生成）、story（故事配音）、music（音乐生成）、sfx（音效生成）、score（编曲）、characters（声音库）、settings（设置）。"}, w.openPageTool)
	w.registerMusicTools(server)
	w.registerAudioTools(server)
	w.registerAgentTools(server)
	return server
}
