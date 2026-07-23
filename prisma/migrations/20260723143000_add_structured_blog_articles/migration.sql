CREATE TYPE "BlogArticleFormat" AS ENUM (
  'SIMPLE',
  'SUGGESTION',
  'TOP_10',
  'GUIDE',
  'DATA_ANALYSIS',
  'FACE_TO_FACE',
  'PORTRAIT',
  'RETROSPECTIVE'
);

ALTER TABLE "blog_articles"
  ADD COLUMN "format" "BlogArticleFormat" NOT NULL DEFAULT 'SIMPLE',
  ADD COLUMN "titleFr" TEXT,
  ADD COLUMN "titleEn" TEXT,
  ADD COLUMN "introFr" TEXT,
  ADD COLUMN "introEn" TEXT,
  ADD COLUMN "conclusionFr" TEXT,
  ADD COLUMN "conclusionEn" TEXT;

CREATE TABLE "blog_article_items" (
  "id" SERIAL NOT NULL,
  "articleId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "tmdbId" INTEGER,
  "type" TEXT,
  "title" TEXT NOT NULL,
  "channelTitle" TEXT,
  "posterPath" TEXT,
  "countryCount" INTEGER,
  "sectionTitleFr" TEXT,
  "sectionTitleEn" TEXT,
  "sectionTextFr" TEXT,
  "sectionTextEn" TEXT,

  CONSTRAINT "blog_article_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blog_article_items_articleId_position_key"
  ON "blog_article_items"("articleId", "position");

CREATE INDEX "blog_article_items_tmdbId_idx"
  ON "blog_article_items"("tmdbId");

ALTER TABLE "blog_article_items"
  ADD CONSTRAINT "blog_article_items_articleId_fkey"
  FOREIGN KEY ("articleId")
  REFERENCES "blog_articles"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

UPDATE "blog_articles"
SET
  "titleFr" = "title",
  "titleEn" = "title",
  "introFr" = "editorialFr",
  "introEn" = "editorialEn";

INSERT INTO "blog_article_items" (
  "articleId",
  "position",
  "tmdbId",
  "type",
  "title",
  "channelTitle",
  "posterPath",
  "countryCount"
)
SELECT
  "id",
  1,
  "tmdbId",
  "type",
  "title",
  "channelTitle",
  "posterPath",
  "countryCount"
FROM "blog_articles";
