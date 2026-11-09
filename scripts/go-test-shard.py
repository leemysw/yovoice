"""把 go test ./... 拆到多台机器上跑，每个用例恰好跑一次。

用法：python3 scripts/go-test-shard.py 序号 总数 [go test 参数...]
- 总数为 1 时等同 go test 参数 ./...
- 第 1 片跑除最慢包以外的全部包；其余各片按名字轮流分摊最慢包的顶层用例（子用例随顶层一起跑）。
"""
import subprocess
import sys

# 最慢的包：Windows 上单包超过 100 秒，其余包合计也只有它的一半左右。
SPLIT = 'yovoice/internal/workbench'


def go(*args):
    return subprocess.run(['go', *args], check=True, capture_output=True, text=True).stdout.split()


def main():
    index, total, flags = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
    if not 1 <= index <= total:
        raise SystemExit('分片序号超出范围')
    if total == 1:
        command = ['go', 'test', *flags, './...']
    elif index == 1:
        packages = [name for name in go('list', './...') if name != SPLIT]
        command = ['go', 'test', *flags, *packages]
    else:
        names = sorted(name for name in go('test', *flags, '-list', '.', SPLIT) if name.startswith(('Test', 'Example', 'Fuzz')))
        picked = names[index - 2::total - 1]
        if not picked:
            raise SystemExit('该分片没有分到用例，请减少分片数')
        print(f'{SPLIT}：{len(names)} 个用例中的 {len(picked)} 个', flush=True)
        command = ['go', 'test', *flags, '-run', '^(' + '|'.join(picked) + ')$', SPLIT]
    sys.exit(subprocess.run(command).returncode)


main()
