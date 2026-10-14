# typren

The CLI for [Typren](https://github.com/typren/typren). It scaffolds a
Next.js project onto typren's content layer, keeps that project's settings in
sync with `typren.config.json`, and reviews markdown content before it ships.

## Install

```bash
npm install typren
```

It can also be run without installing it first:

```bash
npx typren init
```

## Quickstart

```bash
npx typren init              # scaffold the content layer into a Next.js App Router project
npx typren apply-settings    # wire next.config/cms.config to typren.config.json
npx typren review            # deterministic content checks against changed pages
npx typren migrate           # after upgrading @typren/core, apply its migration notes
```

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-cli.md) for every command, flag and error.

## License

[Functional Source License 1.1](./LICENSE), converting to Apache 2.0 two years
after each release. Free to use, modify and self-host for anything except a
competing hosted version of Typren. See
[the repository](https://github.com/typren/typren#license) for what that
means in practice.
