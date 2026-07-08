CREATE INDEX "article_revisions_article_saved_idx" ON "article_revisions" USING btree ("article_id","saved_at");--> statement-breakpoint
CREATE INDEX "article_tags_tag_idx" ON "article_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "articles_feed_idx" ON "articles" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "articles"."status" = 'published' AND "articles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "articles_author_idx" ON "articles" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "articles_category_idx" ON "articles" USING btree ("category_id");