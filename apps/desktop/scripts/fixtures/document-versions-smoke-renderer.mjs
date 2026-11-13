/** Serialized into the application's renderer; all writes use the actual Preload. */
export async function documentVersionsSmokeInRenderer({ phase, saved }) {
  const api = globalThis.deepwrite;
  const ensure = (condition, message) => {
    if (!condition) throw new Error(`Document versions smoke: ${message}`);
  };
  const expectCode = async (action, code) => {
    try {
      await action();
    } catch (error) {
      ensure(error.code === code, `expected ${code}, received ${error.code}`);
      return;
    }
    throw new Error(`Document versions smoke: expected ${code}`);
  };
  ensure(api?.versions, "version API missing");
  const settings = (await api.generalSettings.list()).settings;
  if (phase === "reopen") {
    ensure(settings.versionHistoryEnabled, "enabled setting was lost");
    for (const item of [saved.short, saved.long]) {
      const listed = await api.versions.list({ target: item.target });
      ensure(
        listed.versions.length === item.count,
        "version count changed on restart"
      );
      ensure(
        listed.current.sha256 === item.sha256,
        "current hash changed on restart"
      );
      ensure(
        (
          await api.versions.read({
            target: item.target,
            versionId: listed.versions[0].id
          })
        ).content === item.content,
        "latest content changed on restart"
      );
    }
    return {
      checks: { restart: true, settings: true, short: true, long: true }
    };
  }
  ensure(
    settings.versionHistoryEnabled === false,
    "version history must default to off"
  );
  const book = await api.catalog.createShortBook({
    title: "版本冒烟短篇",
    genre: "其他"
  });
  const target = {
    workspace: "catalog",
    bookId: book.id,
    documentId: book.documents[0].id
  };
  const readCurrent = () =>
    api.catalog.readDocument({
      projectId: book.id,
      target: "document",
      documentId: target.documentId
    });
  const write = async (content, runId) => {
    const document = await readCurrent();
    await api.catalog.saveDocument({
      bookId: book.id,
      documentId: target.documentId,
      content,
      baseProjectRevision: document.projectRevision,
      ...(runId
        ? {
            versionOrigin: {
              sessionId: "version-smoke-session",
              runId,
              summary: "修改正文"
            }
          }
        : {})
    });
  };
  await write("手写原文");
  await expectCode(() => api.versions.list({ target }), "version.disabled");
  await api.generalSettings.save({ ...settings, versionHistoryEnabled: true });
  ensure(
    (await api.versions.list({ target })).versions.length === 0,
    "manual save created a version"
  );
  await write("第一轮初稿", "smoke-run-1");
  await write("第一轮终稿", "smoke-run-1");
  let listed = await api.versions.list({ target });
  ensure(
    listed.versions.length === 2 && listed.versions[0].seq === 2,
    "same run was not merged"
  );
  const original = listed.versions[1];
  ensure(
    original.kind === "pre_conversation",
    "manual content was not captured"
  );
  ensure(
    (await api.versions.read({ target, versionId: listed.versions[0].id }))
      .content === "第一轮终稿",
    "merged content differs"
  );
  await write("第二轮正文", "smoke-run-2");
  ensure(
    (await api.versions.list({ target })).versions.length === 3,
    "new run did not create a version"
  );
  await write("回退前手写内容");
  listed = await api.versions.list({ target });
  ensure(
    listed.versions.length === 3 &&
      listed.current.sha256 !== listed.versions[0].sha256,
    "manual edit was independently versioned"
  );
  const restored = await api.versions.restore({
    target,
    versionId: original.id,
    expectedCurrentSha256: listed.current.sha256
  });
  ensure(
    restored.workspace === "catalog" &&
      restored.document.content === "手写原文",
    "restore did not refresh the saved document"
  );
  listed = await api.versions.list({ target });
  ensure(
    listed.versions.length === 5 && listed.versions[0].kind === "restore",
    "restore history differs"
  );
  const beforeRestore = listed.versions.find(
    (version) => version.reason === "restore"
  );
  ensure(beforeRestore, "manual content before restore was not saved");
  const staleHash = listed.current.sha256;
  await write("冲突中的当前内容");
  await expectCode(
    () =>
      api.versions.restore({
        target,
        versionId: original.id,
        expectedCurrentSha256: staleHash
      }),
    "version.conflict"
  );
  listed = await api.versions.list({ target });
  ensure(
    listed.versions.length === 5 &&
      (await readCurrent()).content === "冲突中的当前内容",
    "conflict mutated content or history"
  );
  await api.versions.restore({
    target,
    versionId: beforeRestore.id,
    expectedCurrentSha256: listed.current.sha256
  });
  ensure(
    (await readCurrent()).content === "回退前手写内容",
    "restore could not be restored again"
  );
  const beforeDisabled = (await api.versions.list({ target })).versions.length;
  await api.generalSettings.save({ ...settings, versionHistoryEnabled: false });
  await write("关闭期间正文", "smoke-disabled-run");
  await expectCode(
    () => api.versions.read({ target, versionId: original.id }),
    "version.disabled"
  );
  await api.generalSettings.save({ ...settings, versionHistoryEnabled: true });
  ensure(
    (await api.versions.list({ target })).versions.length === beforeDisabled,
    "disabled write created a version"
  );
  await write("重新开启后的正文", "smoke-run-3");
  listed = await api.versions.list({ target });
  ensure(
    listed.versions.length === beforeDisabled + 2,
    "disabled-period content was not captured on next write"
  );
  await api.catalog.updateBook({
    bookId: book.id,
    title: "版本冒烟短篇重命名"
  });
  ensure(
    (await api.versions.list({ target })).versions.length ===
      listed.versions.length,
    "rename lost history"
  );

  const longBook = await api.long.create({
    title: "版本冒烟长篇",
    genre: "其他"
  });
  const body = longBook.book.workspaceIndex.chapters[0].body;
  const longTarget = {
    workspace: "long",
    bookId: longBook.book.id,
    fileId: body.id
  };
  await api.long.writeDocument({
    bookId: longTarget.bookId,
    fileId: body.id,
    content: "长篇手写原文"
  });
  await api.generalSettings.save({ ...settings, versionHistoryEnabled: false });
  await api.long.applyOperations({
    bookId: longTarget.bookId,
    versionOrigin: {
      sessionId: "long-version-session",
      runId: "long-disabled-run",
      summary: "关闭期间修改章节"
    },
    batch: {
      updatedAt: new Date().toISOString(),
      operations: [],
      documentWrites: [
        {
          proposalId: "proposal_long_disabled",
          fileId: body.id,
          mode: "replace",
          content: "长篇关闭期间正文",
          updatedAt: new Date().toISOString(),
          reason: "版本冒烟"
        }
      ]
    }
  });
  await api.generalSettings.save({ ...settings, versionHistoryEnabled: true });
  ensure(
    (await api.versions.list({ target: longTarget })).versions.length === 0,
    "disabled long write created a version"
  );
  await api.long.writeDocument({
    bookId: longTarget.bookId,
    fileId: body.id,
    content: "长篇手写原文"
  });
  for (const [index, content] of [
    "长篇第一轮初稿",
    "长篇第一轮终稿"
  ].entries()) {
    await api.long.applyOperations({
      bookId: longTarget.bookId,
      versionOrigin: {
        sessionId: "long-version-session",
        runId: "long-smoke-run",
        summary: "修改章节"
      },
      batch: {
        updatedAt: new Date().toISOString(),
        operations: [],
        documentWrites: [
          {
            proposalId: `proposal_long_run_${index}`,
            fileId: body.id,
            mode: "replace",
            content,
            updatedAt: new Date().toISOString(),
            reason: "版本冒烟"
          }
        ]
      }
    });
  }
  let longListed = await api.versions.list({ target: longTarget });
  ensure(
    longListed.versions.length === 2,
    "long same-run writes were not merged"
  );
  const longConversationVersion = longListed.versions[0];
  const restoredLong = await api.versions.restore({
    target: longTarget,
    versionId: longListed.versions[1].id,
    expectedCurrentSha256: longListed.current.sha256
  });
  ensure(
    restoredLong.workspace === "long" &&
      (
        await api.long.readDocument({
          bookId: longTarget.bookId,
          fileId: body.id
        })
      ).content === "长篇手写原文",
    "long restore did not write the target text"
  );
  longListed = await api.versions.list({ target: longTarget });
  await api.versions.restore({
    target: longTarget,
    versionId: longConversationVersion.id,
    expectedCurrentSha256: longListed.current.sha256
  });
  longListed = await api.versions.list({ target: longTarget });
  await api.long.rename({
    bookId: longTarget.bookId,
    title: "版本冒烟长篇重命名"
  });
  ensure(
    (await api.versions.list({ target: longTarget })).versions.length ===
      longListed.versions.length,
    "long rename lost history"
  );
  const short = {
    target,
    count: listed.versions.length,
    sha256: listed.current.sha256,
    content: "重新开启后的正文"
  };
  const long = {
    target: longTarget,
    count: longListed.versions.length,
    sha256: longListed.current.sha256,
    content: "长篇第一轮终稿"
  };
  return {
    short,
    long,
    checks: {
      defaultOff: true,
      manualCapture: true,
      sameRunMerge: true,
      newRun: true,
      restore: true,
      restoreAgain: true,
      conflict: true,
      settings: true,
      rename: true,
      long: true
    }
  };
}
