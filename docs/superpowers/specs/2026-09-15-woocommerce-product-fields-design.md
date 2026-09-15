# WooCommerce product fields

Prody becomes the source of truth for products on the WooCommerce shop. A
product is written here, pushed to the shop with a button, and later edits in
Prody update the same record rather than creating a second one.

## Why

Product copy for the shop does not exist anywhere in Prody today. `description`
is present but averages 105 characters across the 350 products that have it —
an internal note, not shop copy. Nothing records whether a product has reached
the shop, so there is no way to answer "what still needs publishing".

## Scope

Core product data only: titles, descriptions, ingredients, usage, warnings,
price and stock. Deliberately excluded, each its own piece of work if it is ever
wanted:

- Images (they live in Supabase Storage; moving them to WordPress is separate)
- SEO fields (meta title, meta description, slug)
- Categories, tags, attributes, related products
- Bulk push of many products at once
- Any sync back from WooCommerce into Prody

## Data

Eight nullable columns on `products`:

| Column | Holds | Maps to |
|---|---|---|
| `wp_title` | Shop title | `name` |
| `wp_description` | Full description | `description` |
| `wp_short_description` | Short description | `short_description` |
| `wp_ingredients` | Ingredients | meta `_ingredients` |
| `wp_usage` | How to use | meta `_usage` |
| `wp_warnings` | Warnings | meta `_warnings` |
| `wp_product_id` | WooCommerce product id | — internal |
| `wp_synced_at` | Last successful push | — internal |

`wp_product_id` and `wp_synced_at` are written by the application, never by
hand. Their presence is what distinguishes a create from an update.

Ingredients, usage and warnings are three fields rather than one because the
shop displays them separately. Collapsing them later is easy; splitting a
combined field after it holds data is not.

**Theme dependency:** WooCommerce stores custom fields but does not render
them. The theme must be checked to confirm it displays `_ingredients`,
`_usage` and `_warnings`, or they will be saved and invisible. This is a
verification step before the feature is considered done, not a code change.

## Product form

A collapsed section, "За уебсайта", holding the six editable fields. Collapsed
by default so products that never reach the shop are unaffected.

Next to the title field, a **Копирай от Prody** button fills it with the
product's catalogue name. Names will often differ between Prody and the shop,
so this stays an action the user takes rather than a default — a title that was
never touched is one nobody decided on, and that distinction is what the
validation below depends on.

## Catalogue

A marker on products already pushed, with the date. A filter, **Не е в сайта**,
alongside the existing "Без категория", listing what has not been published.

## Pushing

A **Изпрати към сайта** button on the product page.

`wp_title` is required. With it empty the button is disabled and says why,
rather than failing on click. Everything else is optional.

First push creates the product and stores `wp_product_id`. Subsequent pushes
update that record by id.

Sent on each push: title, both descriptions, price, the three meta fields,
stock quantity (summed from `stock_batches`, which a physical count confirmed
is the accurate side), and SKU where one exists.

## Failure

Validation runs before the request, so a missing title never reaches
WooCommerce.

A rejection from WooCommerce surfaces as-is. The product stays unpushed and
`wp_synced_at` is untouched — the same failure mode the sale and request paths
were just corrected for, where a swallowed error left a record claiming
something that had not happened.

There is no partial state: either the product is on the shop and recorded as
such, or it is not.

## Credentials

The WooCommerce consumer key and secret go in environment variables, never in
the repository and never in conversation. They carry write access to the shop.

The integration is built against the WooCommerce REST API v3 documentation and
verified against staging. One real request/response pair from the actual shop
should be observed before the first production push, since field shapes vary
between WooCommerce versions.

## Testing

Against staging only. Production is not touched — no schema changes, no pushes,
no credentials — until the feature has been exercised locally and the user
decides to deploy it.
