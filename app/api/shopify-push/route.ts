import { NextResponse } from "next/server"
import { sanitizeDomain, SHOPIFY_API_VERSION } from "@/lib/shopify"

interface StagedUploadTarget {
  url: string
  resourceUrl: string
  parameters: { name: string; value: string }[]
}

interface PushImage {
  url: string
  name: string
}

interface RequestBody {
  targetDomain: string
  targetToken: string
  images: PushImage[]
}

/**
 * 在目标站点按文件名搜索，判断文件是否已存在。
 * 用 GraphQL files 查询，匹配 alt 或 filename。
 */
async function fileExists(
  domain: string,
  token: string,
  fileName: string,
): Promise<boolean> {
  // 搜索策略：先用精确文件名，再去掉扩展名搜一次
  const stem = fileName.replace(/\.[^.]+$/, "")
  const queries = [
    `filename:${JSON.stringify(fileName)}`,
    `filename:${JSON.stringify(stem)}`,
  ]

  for (const query of queries) {
    const gql = `{
      files(first:5, query:${JSON.stringify(query)}) {
        edges { node { alt ... on MediaImage { image { url } } } }
      }
    }`

    const res = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: gql }),
      },
    )

    if (!res.ok) continue
    const data = await res.json()
    const edges = data?.data?.files?.edges ?? []

    for (const edge of edges) {
      const node = edge.node
      // alt 通常存的就是原始文件名
      const alt: string = node.alt ?? ""
      if (
        alt.toLowerCase() === fileName.toLowerCase() ||
        alt.toLowerCase() === stem.toLowerCase()
      ) {
        return true
      }
      // MediaImage 的 url 末尾也包含文件名
      const imgUrl: string = node.image?.url ?? ""
      if (imgUrl) {
        const urlName = imgUrl.split("/").pop()?.split("?")[0] ?? ""
        if (
          urlName.toLowerCase() === fileName.toLowerCase() ||
          urlName.toLowerCase() === stem.toLowerCase()
        ) {
          return true
        }
      }
    }
  }

  // 兜底：REST files 列表搜索
  try {
    const restRes = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/files.json?limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    )
    if (restRes.ok) {
      const restData = await restRes.json()
      const files: { alt?: string; filename?: string }[] =
        restData.files ?? []
      const lowerName = fileName.toLowerCase()
      const lowerStem = stem.toLowerCase()
      for (const f of files) {
        const fAlt = (f.alt ?? "").toLowerCase()
        const fFn = (f.filename ?? "").toLowerCase()
        if (fAlt === lowerName || fAlt === lowerStem) return true
        if (fFn === lowerName || fFn === lowerStem) return true
      }
    }
  } catch {
    // REST 搜索失败不影响结论
  }

  return false
}

/** 创建 staged upload，获取上传 URL */
async function createStagedUpload(
  domain: string,
  token: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<StagedUploadTarget> {
  const mutation = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }`

  const res = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: [
            {
              resource: "IMAGE",
              filename: fileName,
              mimeType,
              fileSize: fileSize.toString(),
              httpMethod: "POST",
            },
          ],
        },
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`创建 staged upload 失败 (${res.status})`)
  }

  const data = await res.json()
  const targets = data?.data?.stagedUploadsCreate?.stagedTargets
  const errors = data?.data?.stagedUploadsCreate?.userErrors

  if (errors?.length > 0) {
    throw new Error(`Staged upload 错误: ${errors[0].message}`)
  }

  if (!targets?.length) {
    throw new Error("未获取到 staged upload URL")
  }

  return targets[0]
}

/** 通过 staged upload 直接上传图片二进制数据 */
async function uploadViaStagedUpload(
  domain: string,
  token: string,
  imageBuffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
): Promise<void> {
  // 1. 创建 staged upload
  const staged = await createStagedUpload(
    domain,
    token,
    fileName,
    mimeType,
    imageBuffer.byteLength,
  )

  // 2. 上传到 staged URL
  const formData = new FormData()
  for (const param of staged.parameters) {
    formData.append(param.name, param.value)
  }
  formData.append("file", new Blob([imageBuffer], { type: mimeType }), fileName)

  const uploadRes = await fetch(staged.url, {
    method: "POST",
    body: formData,
  })

  if (!uploadRes.ok) {
    throw new Error(`上传到 staged URL 失败 (${uploadRes.status})`)
  }

  // 3. 通过 files API 创建文件记录
  const createMutation = `mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id alt }
      userErrors { field message }
    }
  }`

  const createRes = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: createMutation,
        variables: {
          files: [
            {
              alt: fileName,
              contentType: "IMAGE",
              originalSource: staged.resourceUrl,
            },
          ],
        },
      }),
    },
  )

  if (!createRes.ok) {
    throw new Error(`创建文件记录失败 (${createRes.status})`)
  }

  const createData = await createRes.json()
  const createErrors = createData?.data?.fileCreate?.userErrors

  if (createErrors?.length > 0) {
    throw new Error(`创建文件记录错误: ${createErrors[0].message}`)
  }
}

/** 下载图片到服务端 */
async function downloadImage(
  imageUrl: string,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const res = await fetch(imageUrl)
  if (!res.ok) {
    throw new Error(`下载图片失败 (${res.status}): ${imageUrl}`)
  }

  const contentType = res.headers.get("content-type") || "image/jpeg"
  const buffer = await res.arrayBuffer()

  return { buffer, mimeType: contentType }
}

/** 上传图片到 Shopify（优先 src 模式，失败则直接上传） */
async function uploadFile(
  domain: string,
  token: string,
  imageUrl: string,
  fileName: string,
): Promise<"src" | "direct"> {
  // 策略 1: src 模式（适用于 Shopify 内部 CDN URL）
  const srcUrl = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/files.json`

  const srcRes = await fetch(srcUrl, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      file: {
        src: imageUrl,
        alt: fileName,
      },
    }),
  })

  if (srcRes.ok) return "src"

  // src 模式失败，检查错误
  let srcError = ""
  try {
    const json = await srcRes.json()
    srcError = JSON.stringify(json.errors || json.error || json)
  } catch {
    srcError = await srcRes.text().catch(() => "")
  }

  // 策略 2: 下载图片后直接上传（适用于外链图片）
  try {
    const { buffer, mimeType } = await downloadImage(imageUrl)
    await uploadViaStagedUpload(domain, token, buffer, fileName, mimeType)
    return "direct"
  } catch (directErr) {
    throw new Error(
      `上传失败:\n` +
        `- src 模式 (${srcRes.status}): ${srcError}\n` +
        `- 直接上传: ${directErr instanceof Error ? directErr.message : "未知错误"}`,
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody
    const { targetDomain, targetToken, images } = body

    if (!targetDomain || !targetToken) {
      return NextResponse.json(
        { error: "缺少目标站点凭证" },
        { status: 400 },
      )
    }
    if (!images || images.length === 0) {
      return NextResponse.json({ error: "没有要推送的图片" }, { status: 400 })
    }

    const domain = sanitizeDomain(targetDomain)

    // NDJSON 流式响应
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const write = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
        }

        for (const img of images) {
          try {
            const exists = await fileExists(domain, targetToken, img.name)
            if (exists) {
              write({ name: img.name, status: "skipped" })
              continue
            }

            const method = await uploadFile(
              domain,
              targetToken,
              img.url,
              img.name,
            )
            write({
              name: img.name,
              status: "uploaded",
              method, // "src" 或 "direct"
            })
          } catch (err) {
            write({
              name: img.name,
              status: "error",
              error: err instanceof Error ? err.message : "未知错误",
            })
          }
        }

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "推送失败" },
      { status: 500 },
    )
  }
}
