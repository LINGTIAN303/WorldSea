"""
P0-4: 解 ui-kit ↔ plugin-sdk 循环依赖
批量修改消费者文件：将业务符号的 import 从 @worldsmith/ui-kit 迁移到 @worldsmith/plugin-sdk

策略：
1. 扫描 src/ 下所有 .ts/.vue 文件
2. 找到 import { ... } from '@worldsmith/ui-kit' 语句
3. 解析符号，分为业务符号和非业务符号
4. 全业务符号 → 替换 from 路径为 @worldsmith/plugin-sdk
5. 混合 → 拆分为两个 import 语句
6. 全非业务符号 → 不修改
"""

import re
import os
from pathlib import Path

# 业务符号集合（来自 plugin-sdk 的组件、类型、composables）
BUSINESS_SYMBOLS = {
    # 业务组件
    'SchemaRenderer', 'GenericEntityView', 'EntityDetailPanel', 'EntityFormModal',
    'DetailField', 'CreateButton', 'CustomDropdown', 'DynamicFieldsAdder',
    'UniversalRelationPanel', 'BatchEditModal', 'EntityRelationSelector',
    'DynamicEntityView', 'EmptyState', 'LoadingSkeleton', 'ImageField',
    'ImageLightbox', 'EntityCardCover', 'EntityCardBack',
    # 类型
    'FormFieldDef', 'RelationTabDef', 'DetailTab',
    # Entity Composables
    'useEntityEdit', 'EditFormValues', 'useBatchDelete', 'useDuplicateNameCheck',
    'useDialog', 'useConfirm', 'ConfirmType', 'useResizable',
    'getAllPanelWidths', 'resetPanelWidth', 'resetAllPanelWidths', 'PANEL_LABELS',
    'ResizableOptions', 'useHighlight', 'HighlightOptions', 'useShortcuts',
    'formatKeyForDisplay', 'formatKeysForDisplay', 'ShortcutScope', 'ShortcutDef',
    'ShortcutConflict', 'useSelection', 'SelectionKey', 'provideGlobalSelection',
    'SelectionState',
}

PROJECT_ROOT = Path(r'd:\本地化AI\DeepSeek_Home\worldsmith')
SRC_DIR = PROJECT_ROOT / 'src'

# 匹配 import { ... } from '@worldsmith/ui-kit' （单行）
# 支持 type 前缀：import { foo, type Bar } from '...'
IMPORT_PATTERN = re.compile(
    r"import\s*\{([^}]+)\}\s*from\s*'@worldsmith/ui-kit'"
)


def parse_symbols(symbol_str: str) -> list:
    """解析 import { ... } 中的符号列表，保留 type 前缀"""
    symbols = []
    for part in symbol_str.split(','):
        part = part.strip()
        if not part:
            continue
        symbols.append(part)
    return symbols


def get_symbol_name(symbol: str) -> str:
    """从 'type Foo' 或 'Foo' 或 'Foo as Bar' 中提取原始符号名"""
    symbol = symbol.strip()
    # 去掉 type 前缀
    if symbol.startswith('type '):
        symbol = symbol[5:].strip()
    # 去掉 as 别名
    if ' as ' in symbol:
        symbol = symbol.split(' as ')[0].strip()
    return symbol


def split_symbols(symbols: list):
    """将符号列表分为业务符号和非业务符号两组"""
    business = []
    non_business = []
    for sym in symbols:
        name = get_symbol_name(sym)
        if name in BUSINESS_SYMBOLS:
            business.append(sym)
        else:
            non_business.append(sym)
    return business, non_business


def process_import_match(match) -> str:
    """处理单个 import 匹配，返回替换后的字符串"""
    symbol_str = match.group(1)
    symbols = parse_symbols(symbol_str)
    business, non_business = split_symbols(symbols)

    if not business:
        # 全非业务符号，不修改
        return match.group(0)

    if not non_business:
        # 全业务符号，替换 from 路径
        return f"import {{ {', '.join(business)} }} from '@worldsmith/plugin-sdk'"

    # 混合：拆分为两个 import
    business_import = f"import {{ {', '.join(business)} }} from '@worldsmith/plugin-sdk'"
    non_business_import = f"import {{ {', '.join(non_business)} }} from '@worldsmith/ui-kit'"
    return f"{business_import}\n{non_business_import}"


def process_file(filepath: Path) -> bool:
    """处理单个文件，返回是否修改"""
    try:
        content = filepath.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  [ERROR] 读取失败 {filepath}: {e}")
        return False

    if "@worldsmith/ui-kit" not in content:
        return False

    new_content = IMPORT_PATTERN.sub(process_import_match, content)

    if new_content != content:
        filepath.write_text(new_content, encoding='utf-8')
        return True
    return False


def main():
    modified_files = []
    scanned = 0

    # 扫描 src/ 下所有 .ts 和 .vue 文件
    for ext in ['*.ts', '*.vue']:
        for filepath in SRC_DIR.rglob(ext):
            # 跳过 node_modules
            if 'node_modules' in str(filepath):
                continue
            scanned += 1
            if process_file(filepath):
                modified_files.append(filepath.relative_to(PROJECT_ROOT))

    print(f"\n扫描完成：{scanned} 个文件")
    print(f"修改完成：{len(modified_files)} 个文件\n")
    for f in modified_files:
        print(f"  [MODIFIED] {f}")


if __name__ == '__main__':
    main()
