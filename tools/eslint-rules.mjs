// Each repository convention is its own rule so folders can enable them independently.
function selectorRule(selectors, message) {
  return {
    meta: { type: "problem", schema: [], messages: { banned: message } },
    create(context) {
      return Object.fromEntries(
        selectors.map((selector) => [
          selector,
          (node) => context.report({ node, messageId: "banned" })
        ])
      );
    }
  };
}

const SHARED_HELPERS =
  "/^(isRecord|isPlainRecord|isSchemaRecord|isObject|isNodeError|escapeRegExp|escapeRegularExpression|formatBytes|ipcSafeJson|jsonClone|sha256Hex|writeJsonAtomic|writeFileAtomic|writeTextFileDurable|atomicWrite\\w*|toJsonFileText|serializeJson|focusableElements|chineseSectionNumber)$/u";

export const deepwriteRules = {
  "no-double-cast": selectorRule(
    [
      'TSAsExpression[expression.type="TSAsExpression"][expression.typeAnnotation.type="TSUnknownKeyword"]'
    ],
    "不要用 `as unknown as` 绕过类型：用 Zod 解析、类型谓词或正确的类型；测试 Mock 才可以这样写。"
  ),
  "no-json-clone": selectorRule(
    [
      'CallExpression[callee.object.name="JSON"][callee.property.name="parse"] > CallExpression[callee.object.name="JSON"][callee.property.name="stringify"]'
    ],
    "用 @deepwrite/shared 的 jsonClone()；需要保留 undefined 或 Date 时用 structuredClone()。"
  ),
  "no-local-helper": selectorRule(
    [
      `FunctionDeclaration[id.name=${SHARED_HELPERS}]`,
      `VariableDeclarator[id.name=${SHARED_HELPERS}][init.type=/^(ArrowFunctionExpression|FunctionExpression)$/]`
    ],
    "这个工具函数已有唯一实现：通用的从 @deepwrite/shared 或 @deepwrite/shared/node 导入，对话框键盘用 useDialogKeyboard，章节序号用 contracts 的 chineseSectionNumber。"
  ),
  "no-inline-rejection": selectorRule(
    [
      'ObjectExpression:has(> Property[key.name="status"][value.value="rejected"]):has(> Property[key.name="error"][value.type="ObjectExpression"])'
    ],
    "用 main/ipc/errors.ts 的 rejectedResult(requestId, code, message, details)。"
  ),
  "no-core-registry": selectorRule(
    ["Literal[value=/^(catalog-registry|long-project-registry)(\\.json)?$/]"],
    "作品与路径注册表只归 Core 管：经 Core 命令（如 catalog.listBackupProjects、catalog.openProjectAtPath）读写。"
  ),
  "renderer-bridge": selectorRule(
    ['MemberExpression[property.name="deepwrite"]'],
    "只有 renderer/src/api/deepwrite.ts 能访问 Preload 桥，其他地方调用 deepwriteApi()。"
  ),
  "renderer-storage": selectorRule(
    [
      'MemberExpression[property.name="localStorage"]',
      'Identifier[name="localStorage"]:not(MemberExpression > Identifier.property)'
    ],
    "界面偏好用 utils/uiStorage.ts 的 uiStorage()/optionalUiStorage()；作品内容不能存进 localStorage。"
  ),
  "renderer-native-dialog": selectorRule(
    [
      'CallExpression[callee.type="Identifier"][callee.name=/^(alert|confirm|prompt)$/]',
      "CallExpression[callee.property.name=/^(alert|confirm|prompt)$/][callee.object.name=/^(window|globalThis)$/]"
    ],
    "用 ui-confirm.ts 的 uiConfirm()，或 uiMessage 提示。"
  ),
  "renderer-error-text": selectorRule(
    [
      'ConditionalExpression[test.type="BinaryExpression"][test.operator="instanceof"][test.right.name="Error"][consequent.property.name="message"]',
      'FunctionDeclaration[id.name="errorMessage"]'
    ],
    "给用户看的错误文案用 i18n/errors.ts 的 formatError(error, fallback)，需要原因细节时用 getErrorDetail。"
  )
};
