package workbench

import (
	"bytes"
	"context"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yovoice/internal/domain"
	"yovoice/internal/store"
)

func TestTimelinePersistenceAndSourceProtection(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := domain.DefaultDraft()
	id := domain.NewID()
	file := filepath.Join(w.Store.Root, "outputs", id+".wav")
	must(t, os.WriteFile(file, wav(), 0600))
	must(t, w.Store.Update(func(s *domain.State) {
		s.History = []domain.Generation{{ID: id, Title: "片段", FileName: id + ".wav", CreatedAt: time.Now(), Duration: 1, Settings: d}}
	}, true))
	d.Timeline = &domain.AudioTimeline{Tracks: []domain.AudioLane{{ID: "track", Name: "音轨 1", Clips: []domain.AudioClip{{ID: "clip", GenerationID: id, Start: 3, Offset: 0.25, Duration: 0.5}}}}}
	must(t, w.SaveDraft(d))
	st, err := store.New(w.Store.Root)
	must(t, err)
	if st.Read().Drafts[0].Timeline.Tracks[0].Clips[0].Start != 3 {
		t.Fatal("时间线未保存")
	}
	if w.DeleteMedia("outputs", id) == nil {
		t.Fatal("不应删除使用中的源音频")
	}
	for _, invalid := range []float64{-1, math.NaN(), math.Inf(1), 86401} {
		d.Timeline.Tracks[0].Clips[0].Start = invalid
		if w.SaveDraft(d) == nil {
			t.Fatal("不应保存非法时间")
		}
	}
	d.Timeline.Tracks[0].Clips[0].Start = 0
	d.Timeline.Tracks[0].Clips[0].Duration = 2
	if w.SaveDraft(d) == nil {
		t.Fatal("不应超过源音频范围")
	}
	d.Timeline.Tracks[0].Clips = nil
	must(t, w.SaveDraft(d))
	must(t, w.DeleteMedia("outputs", id))
	d.Timeline.Tracks = []domain.AudioLane{}
	d.Timeline.AcceptedGenerations = []string{id}
	must(t, w.SaveDraft(d))
	st, err = store.New(w.Store.Root)
	must(t, err)
	saved := st.Read().Drafts[0].Timeline
	if saved == nil || len(saved.Tracks) != 0 || len(saved.AcceptedGenerations) != 1 || saved.AcceptedGenerations[0] != id {
		t.Fatal("删除最后一条空轨后应保留空时间线及已接收版本，避免重新插入已删除的音频")
	}
}

func TestTimelineUploadPersistsWithoutLibraryEntries(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	data := append(wav()[:44], make([]byte, 32000*65)...)
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	binary.LittleEndian.PutUint32(data[40:], uint32(len(data)-44))
	asset, err := w.ImportTimelineFrom(context.Background(), bytes.NewReader(data), "环境音")
	must(t, err)
	if asset.Duration != 65 {
		t.Fatal("导入素材不应受参考音频 60 秒限制")
	}
	d := domain.DefaultDraft()
	d.Timeline = &domain.AudioTimeline{Assets: []domain.AudioAsset{asset}, Tracks: []domain.AudioLane{{ID: "lane", Name: "音轨 1", Clips: []domain.AudioClip{{ID: "clip", AssetID: asset.ID, Offset: 1, Duration: 2}}}}}
	must(t, w.SaveDraft(d))
	st, err := store.New(w.Store.Root)
	must(t, err)
	state := st.Read()
	if len(state.History) != 0 || len(state.Voices) != 0 || len(state.Drafts[0].Timeline.Assets) != 1 {
		t.Fatal("上传素材应仅随作品持久化")
	}
	d.Timeline.Assets[0].Duration = 100
	if w.SaveDraft(d) == nil {
		t.Fatal("不能伪造源音频时长")
	}
	d.Timeline.Assets[0] = asset
	d.Timeline.Tracks[0].Clips[0].GenerationID = domain.NewID()
	if w.SaveDraft(d) == nil {
		t.Fatal("片段不能同时指定两种源")
	}
	d.Timeline.Tracks[0].Clips[0].GenerationID = ""
	d.Timeline.Assets[0].FileName = "../outside.wav"
	if w.SaveDraft(d) == nil {
		t.Fatal("不能越界读取源音频")
	}
}

func TestTimelineEffectValidation(t *testing.T) {
	timeline := &domain.AudioTimeline{Tracks: []domain.AudioLane{{ID: "t", Name: "t", GainDB: 13}}}
	if domain.ValidateTimeline(timeline, nil) == nil {
		t.Fatal("接受越界增益")
	}
	timeline.Tracks[0].GainDB = 0
	timeline.Tracks[0].DuckDB = -1
	if domain.ValidateTimeline(timeline, nil) == nil {
		t.Fatal("接受负压低量")
	}
	timeline.Tracks[0].DuckDB = 12
	timeline.Markers = []domain.AudioMarker{{ID: "m", Name: "x", Time: -1}}
	if domain.ValidateTimeline(timeline, nil) == nil {
		t.Fatal("接受负标记位置")
	}
}
