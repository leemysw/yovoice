package store

import (
	"math"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/schema"
)

// 状态库文件丢失而备份还在时，必须从备份恢复，而不是新建空库再用空库覆盖备份。
func TestMissingDatabaseRestoresFromBackup(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	must(t, err)
	must(t, s.Update(func(state *schema.State) { state.Drafts[0].Title = "备份里的作品" }, true))
	must(t, s.Close())
	// 重新打开会把最新内容刷进备份。
	s, err = New(root)
	must(t, err)
	must(t, s.Close())
	for round := 0; round < 2; round++ {
		must(t, os.Remove(filepath.Join(root, DatabaseFile)))
		// 遗留的回滚日志不能被应用到恢复出来的库上。
		must(t, os.WriteFile(filepath.Join(root, DatabaseFile+"-journal"), []byte("stale"), 0600))
		s, err = New(root)
		must(t, err)
		if got := s.Read().Drafts[0].Title; got != "备份里的作品" {
			t.Fatalf("第 %d 轮未从备份恢复数据: %q", round+1, got)
		}
		if _, err := os.Stat(filepath.Join(root, DatabaseFile+"-journal")); !os.IsNotExist(err) {
			t.Fatal("过期的回滚日志应被移走")
		}
		must(t, s.Close())
	}
}

// 0 字节的状态库（恢复或复制中途被打断）同样从备份恢复，空文件留存为损坏快照，备份不会被空库覆盖。
func TestEmptyDatabaseRestoresFromBackup(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	must(t, err)
	must(t, s.Update(func(state *schema.State) { state.Drafts[0].Title = "备份里的作品" }, true))
	must(t, s.Close())
	s, err = New(root)
	must(t, err)
	must(t, s.Close())
	must(t, os.WriteFile(filepath.Join(root, DatabaseFile), nil, 0600))
	s, err = New(root)
	must(t, err)
	if got := s.Read().Drafts[0].Title; got != "备份里的作品" {
		t.Fatalf("0 字节库未从备份恢复数据: %q", got)
	}
	must(t, s.Close())
	if files, _ := filepath.Glob(filepath.Join(root, "yovoice.corrupt-*.db")); len(files) != 1 {
		t.Fatal("空文件应留存为损坏快照", files)
	}
	// 再删一次库文件：备份仍然完整，没有被空库覆盖。
	must(t, os.Remove(filepath.Join(root, DatabaseFile)))
	s, err = New(root)
	must(t, err)
	defer s.Close()
	if got := s.Read().Drafts[0].Title; got != "备份里的作品" {
		t.Fatalf("备份被覆盖: %q", got)
	}
}

// 删除中途退出留下的 .deleted 文件：仍被引用且原文件不在时改回原名，其余才删除。
func TestDeletedMarkersFollowReferences(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	must(t, err)
	must(t, s.Update(func(state *schema.State) {
		state.Voices = append(state.Voices, schema.Voice{ID: "v", Name: "v", FileName: "a.wav"}, schema.Voice{ID: "c", Name: "c", FileName: "c.wav"})
	}, true))
	must(t, s.Close())
	write := func(rel string) {
		must(t, os.WriteFile(filepath.Join(root, filepath.FromSlash(rel)), []byte("x"), 0600))
	}
	write("voices/a.wav.deleted")
	write("voices/b.wav.deleted")
	write("voices/c.wav")
	write("voices/c.wav.deleted")
	s, err = New(root)
	must(t, err)
	defer s.Close()
	for rel, want := range map[string]bool{"voices/a.wav": true, "voices/a.wav.deleted": false, "voices/b.wav.deleted": false, "voices/c.wav": true, "voices/c.wav.deleted": false} {
		_, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel)))
		if exists := err == nil; exists != want {
			t.Errorf("%s 存在=%v，应为 %v", rel, exists, want)
		}
	}
}

// 内存状态无法序列化时拒绝持久化提交，读取也不能退化成零值状态。
func TestUnserializableStateIsNeverCommittedAsEmpty(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	must(t, err)
	defer s.Close()
	must(t, s.Update(func(state *schema.State) { state.Drafts[0].Title = "保留" }, true))
	must(t, s.Update(func(state *schema.State) {
		state.Voices = append(state.Voices, schema.Voice{ID: "v", Name: "v", FileName: "v.wav", Duration: math.NaN()})
	}, false))
	if err := s.Update(func(state *schema.State) { state.Drafts = nil }, true); err == nil {
		t.Fatal("状态无法序列化时应拒绝提交")
	}
	if got := s.Read(); len(got.Drafts) != 1 || got.Drafts[0].Title != "保留" || len(got.Voices) != 1 {
		t.Fatalf("读取不应返回零值状态: %+v", got)
	}
	must(t, s.Close())
	reopened, err := New(root)
	must(t, err)
	defer reopened.Close()
	if reopened.Read().Drafts[0].Title != "保留" {
		t.Fatal("数据库不应被清空")
	}
}
