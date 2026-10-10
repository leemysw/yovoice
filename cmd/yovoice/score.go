package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/platform"
	"yovoice/internal/score"
	"yovoice/internal/store"
	"yovoice/internal/workbench"
)

const scoreUsage = `编曲：用乐谱 JSON 或 MIDI 描述每个声部，渲染为混音 WAV 和分轨。
  yovoice score render FILE --output WAV [--stems DIR] [--soundfont ID]
  yovoice score midi FILE --output MID
  yovoice score from-midi FILE --output JSON
FILE 为乐谱 JSON（格式见 docs/score_zh.md）或 .mid 文件。渲染前先下载音色库：
  yovoice models download musescore-general-sf2
`

// runScore 处理编曲子命令：格式转换不读写数据目录，渲染只读取已安装的音色库。
func runScore(ctx context.Context, args []string, out, progress io.Writer) error {
	if len(args) == 0 || args[0] == "--help" {
		_, err := fmt.Fprint(out, scoreUsage)
		return err
	}
	command := args[0]
	if !slices.Contains([]string{"render", "midi", "from-midi"}, command) {
		return fmt.Errorf("未知命令 score %s；使用 yovoice score --help 查看用法", command)
	}
	args = args[1:]
	input := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		input, args = args[0], args[1:]
	}
	fs := flag.NewFlagSet("score "+command, flag.ContinueOnError)
	fs.SetOutput(progress)
	root := fs.String("data-dir", "", "数据目录，默认 ~/.yovoice")
	fs.Bool("json", false, "JSON 输出（默认）")
	output := fs.String("output", "", "输出文件，不覆盖已有文件")
	stems, soundFont := "", "musescore-general-sf2"
	if command == "render" {
		fs.StringVar(&stems, "stems", "", "同时写出每个声部的 WAV 到该目录")
		fs.StringVar(&soundFont, "soundfont", soundFont, "音色库 ID")
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if input == "" || fs.NArg() != 0 {
		return fmt.Errorf("需要一个乐谱或 MIDI 文件")
	}
	extension := map[string]string{"render": ".wav", "midi": ".mid", "from-midi": ".json"}[command]
	if *output == "" || !strings.EqualFold(filepath.Ext(*output), extension) {
		return fmt.Errorf("请通过 --output 指定 %s 文件", extension)
	}
	if _, err := os.Lstat(*output); err == nil {
		return fmt.Errorf("输出文件已存在：%s", *output)
	}
	s, err := score.Read(input)
	if err != nil {
		return fmt.Errorf("读取 %s：%w", input, err)
	}
	if *output, err = filepath.Abs(*output); err != nil {
		return err
	}
	switch command {
	case "midi", "from-midi":
		b, e := score.Encode(*output, s)
		if e != nil {
			return e
		}
		err = writeNew(*output, b)
	case "render":
		path, e := installedSoundFont(*root, soundFont)
		if e != nil {
			return e
		}
		if stems != "" {
			if stems, e = filepath.Abs(stems); e != nil {
				return e
			}
			if e = os.MkdirAll(stems, 0700); e != nil {
				return e
			}
		}
		fmt.Fprintln(progress, "加载音色库")
		sf, e := score.LoadSoundFont(path)
		if e != nil {
			return e
		}
		// 先写临时文件，渲染失败或取消时不留下半截输出。
		temp := *output + ".part"
		defer os.Remove(temp)
		e = score.Render(ctx, sf, s, temp, stems, func(done, total int) { fmt.Fprintf(progress, "渲染声部 (%d/%d)\n", done, total) })
		if e == nil {
			e = os.Link(temp, *output)
		}
		err = e
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"path": *output, "duration": s.Duration(), "bars": s.Bars(), "tracks": len(s.Tracks), "stems": stems})
}

func installedSoundFont(root, id string) (string, error) {
	if m, err := catalog.Lookup(id); err != nil || m.Family != "soundfont" {
		return "", fmt.Errorf("未知音色库：%s", id)
	}
	if root == "" {
		var err error
		if root, err = store.DefaultDirectory(); err != nil {
			return "", err
		}
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(abs, 0700); err != nil {
		return "", err
	}
	lock, err := platform.Lock(filepath.Join(abs, "service.lock"))
	if err != nil {
		return "", fmt.Errorf("数据目录正在使用，请退出 App 或指定独立 --data-dir：%w", err)
	}
	defer lock.Close()
	w, err := workbench.New(abs)
	if err != nil {
		return "", err
	}
	defer w.Close()
	for _, m := range w.Store.Read().Models {
		if m.ID == id {
			return m.Path, nil
		}
	}
	return "", fmt.Errorf("音色库未安装，先运行 yovoice models download %s", id)
}

func writeNew(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err != nil {
		f.Close()
		os.Remove(path)
		return err
	}
	return f.Close()
}
