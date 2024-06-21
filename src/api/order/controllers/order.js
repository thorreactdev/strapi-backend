"use strict";
const stripe = require("stripe")
(process.env.STRIPE_KEY);
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { createCoreController } = require("@strapi/strapi").factories;

const encryptionKey = process.env.ENCRYPTION_KEY; // Ensure you have this in your environment variables

const encrypt = (text) => {
  const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
  console.log("cipher" , cipher);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  console.log("encrypted" , encrypted);
  return encrypted;
};

const decrypt = (encrypted) => {
  const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
  console.log("decipher" , decipher);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  console.log("decrypted" , decrypted);
  return decrypted;
};

module.exports = createCoreController("api::order.order", ({ strapi }) => ({
  async create(ctx) {
    const { products } = ctx.request.body;
    try {
      console.log('Received products:', products);

      const lineItems = await Promise.all(
        products.map(async (product) => {
          const item = await strapi
            .service("api::product.product")
            .findOne(product.id);

          console.log('Fetched item:', item);

          const unitAmount = Number(item.Price) * 100;
          console.log(unitAmount);

          if (isNaN(unitAmount)) {
            throw new Error(`Invalid price for product with id ${item.id}`);
          }

          const baseURL = "http://localhost:1337";
          // const imageURL = `${baseURL}${product?.[0]?.attributes?.img?.data?.[0]?.attributes?.formats?.small?.url}`;

          return {
            price_data: {
              currency: "inr",
              product_data: {
                name: item.title,
                // images: [imageURL],
              },
              unit_amount: unitAmount,
            },
            quantity: product.attributes.quantity,
          };
        })
      );

      console.log('Line items:', lineItems);

      const uniqueId = uuidv4();
      const encryptedId = encrypt(uniqueId);

      const session = await stripe.checkout.sessions.create({
        shipping_address_collection: { allowed_countries: ["IN"] },
        payment_method_types: ["card"],
        mode: "payment",
        success_url: `${process.env.CLIENT_URL}/api/payment/success/${encryptedId}`,
        cancel_url: `${process.env.CLIENT_URL}/api/payment/failure/${encryptedId}`,
        line_items: lineItems,
      });

      console.log('Created Stripe session:', session.id);

      await strapi
        .service("api::order.order")
        .create({ data: { products, stripeId: session.id, uniqueId } });

      return { stripeSession: session };
    } catch (error) {
      console.error('Error creating Stripe session:', error);
      ctx.response.status = 500;
      return { error: error.message };
    }
  },

  async validateSuccess(ctx) {
    const { id } = ctx.request.body;
    console.log("validationID" , id);
    try {
      const decryptedId = decrypt(id);
      console.log("decryptID" , decryptedId)
      const order = await strapi.services.order.findOne({ uniqueId: decryptedId });
      console.log("order", order);
      if (!order) {
        return ctx.badRequest('Invalid identifier');
      }
      return { success: true, order };
    } catch (error) {
      return ctx.badRequest('Invalid identifier');
    }
  },

  async findUserOrders(ctx) {
    const user = ctx.state.user; // Get the authenticated user
    try {
      const orders = await strapi.db.query('api::order.order').findMany({
        where: { user: user.id },
        populate: ['products', 'products.img'], // Populate products and their images
      });
      return orders;
    } catch (error) {
      ctx.response.status = 500;
      return { error: error.message };
    }
  }
}));