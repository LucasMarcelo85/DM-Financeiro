ALTER TABLE "product_images" ADD COLUMN "size" TEXT NOT NULL DEFAULT '';
ALTER TABLE "product_images" ADD COLUMN "color" TEXT NOT NULL DEFAULT '';
ALTER TABLE "product_images" ADD COLUMN "color_hex" TEXT NOT NULL DEFAULT '';
ALTER TABLE "store_users" ADD COLUMN "perms" TEXT NOT NULL DEFAULT 'produtos,pedidos,clientes,arquivados';
