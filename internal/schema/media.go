package schema

// MediaRefs 是数据目录中音频文件的唯一引用登记：按目录（voices、outputs）返回仍被状态使用的文件名。
// 任何会物理删除 voices/ 或 outputs/ 文件的逻辑都必须以它为准；新增引用文件的字段时在这里登记，
// TestMediaRefsCoverEveryFileName 会检查 State 中所有 FileName 及以 File 结尾的文件名字段都已纳入。
func (s State) MediaRefs() map[string]map[string]bool {
	outputs, voices := map[string]bool{}, map[string]bool{}
	for _, g := range s.History {
		outputs[g.FileName] = true
	}
	for _, c := range s.Characters {
		if c.Preview != nil {
			outputs[c.Preview.FileName] = true
		}
	}
	// 未保存的试听只在本次会话的内存中，同样不能删除。
	for _, p := range s.Previews {
		outputs[p.FileName] = true
	}
	for _, d := range s.Drafts {
		if d.Timeline != nil {
			for _, asset := range d.Timeline.Assets {
				outputs[asset.FileName] = true
			}
		}
	}
	for _, t := range s.Transcripts {
		outputs[t.FileName] = true
		outputs[t.AudioFile] = true
		outputs[t.VideoFile] = true
	}
	for _, v := range s.Voices {
		voices[v.FileName] = true
	}
	delete(outputs, "")
	delete(voices, "")
	return map[string]map[string]bool{"outputs": outputs, "voices": voices}
}
