import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CACHE_WINDOW_MS = 60 * 1000; // 60 seconds

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Step 1: Check cache — return if fact is less than 60 seconds old
  const recentFact = await prisma.movieFact.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  if (recentFact) {
    const ageMs = Date.now() - recentFact.createdAt.getTime();
    if (ageMs < CACHE_WINDOW_MS) {
      return NextResponse.json({
        fact: recentFact.fact,
        cached: true,
        cachedAt: recentFact.createdAt,
        expiresInSeconds: Math.ceil((CACHE_WINDOW_MS - ageMs) / 1000),
      });
    }
  }

  // Step 2: Burst protection — check if generation is already in progress
  // Uses a DB-level flag so it works across multiple tabs and requests
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user?.favoriteMovie) {
    return NextResponse.json({ error: "No favorite movie set." }, { status: 400 });
  }

  if (user.isGeneratingFact) {
    if (recentFact) {
      return NextResponse.json({
        fact: recentFact.fact,
        cached: true,
        cachedAt: recentFact.createdAt,
        generating: true,
      });
    }
    return NextResponse.json(
      { error: "Fact generation already in progress. Please wait." },
      { status: 429 }
    );
  }

  // Step 3: Acquire lock
  await prisma.user.update({
    where: { id: userId },
    data: { isGeneratingFact: true },
  });

  try {
    // Step 4: Call OpenAI with manual timeout using Promise.race
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `Give me one fun, surprising fact about the movie "${user.favoriteMovie}". Keep it to 2-3 sentences. Do not use markdown.`,
          },
        ],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("OpenAI timeout")), 10000)
      ),
    ]) as Awaited<ReturnType<typeof openai.chat.completions.create>>;

    const fact = completion.choices[0].message.content ?? "No fact generated.";

    // Step 5: Store fact
    const newFact = await prisma.movieFact.create({
      data: {
        fact,
        movie: user.favoriteMovie,
        userId,
      },
    });

    return NextResponse.json({
      fact: newFact.fact,
      cached: false,
      cachedAt: newFact.createdAt,
      expiresInSeconds: 60,
    });
  } catch (error) {
    // Step 6: Failure handling — return cached fact if OpenAI fails
    console.error("[fact generation error]", JSON.stringify(error, null, 2));

    if (recentFact) {
      return NextResponse.json({
        fact: recentFact.fact,
        cached: true,
        cachedAt: recentFact.createdAt,
        fallback: true,
      });
    }

    return NextResponse.json(
      { error: "Failed to generate a fact. Please try again later." },
      { status: 503 }
    );
  } finally {
    // Step 7: Always release lock
    await prisma.user.update({
      where: { id: userId },
      data: { isGeneratingFact: false },
    });
  }
}

// GET — return current cached fact without generating
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recentFact = await prisma.movieFact.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  if (!recentFact) {
    return NextResponse.json({ fact: null });
  }

  const ageMs = Date.now() - recentFact.createdAt.getTime();
  const isFresh = ageMs < CACHE_WINDOW_MS;

  return NextResponse.json({
    fact: recentFact.fact,
    cached: true,
    cachedAt: recentFact.createdAt,
    expiresInSeconds: isFresh ? Math.ceil((CACHE_WINDOW_MS - ageMs) / 1000) : 0,
  });
}