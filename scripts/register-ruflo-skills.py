#!/usr/bin/env python3
"""Register the installed official plugin skill directories without replacing existing skills."""
from pathlib import Path

home = Path.home()
source = home / '.agents/skills/ruflo/plugins'
destination = home / '.codex/skills'
assert source.is_dir(), 'Install official Ruflo skill source first: npx skills add ruvnet/ruflo --all --global --agent codex --yes'
destination.mkdir(parents=True, exist_ok=True)
count = 0
for skill in sorted(source.rglob('SKILL.md')):
    plugin = skill.relative_to(source).parts[0]
    skill_path = '--'.join(skill.parent.relative_to(source / plugin).parts)
    alias = destination / f'{plugin}--{skill_path}'
    legacy = destination / f'{plugin}--{skill.parent.name}'
    if legacy != alias and legacy.is_symlink() and legacy.resolve() == skill.parent.resolve():
        legacy.unlink()
    if alias.is_symlink():
        assert alias.resolve() == skill.parent.resolve(), f'Existing skill points elsewhere: {alias}'
    elif alias.exists():
        raise RuntimeError(f'Refusing to overwrite existing skill: {alias}')
    else:
        alias.symlink_to(skill.parent, target_is_directory=True)
    count += 1
print(f'Official Ruflo plugin skills registered for Codex: {count}')
