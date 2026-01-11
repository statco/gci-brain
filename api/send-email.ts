import { Resend } from 'resend';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers for your domain
  res.setHeader('Access-Control-Allow-Origin', 'https://match.gcitires.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { to, name, orderNumber, tire, quantity, total, withInstallation, installerName } = req.body;

    // Validate required fields
    if (!to || !name || !orderNumber) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Determine language from order data or default to English
    const lang = req.body.lang || 'en';
    const isFrench = lang === 'fr';

    // Send email via Resend
    const data = await resend.emails.send({
      from: 'GCI Tire <onboarding@resend.dev>', // Change to your domain after verification
      to: [to],
      subject: isFrench 
        ? `Confirmation de commande - ${orderNumber}` 
        : `Order Confirmation - ${orderNumber}`,
      html: generateEmailHTML({
        name,
        orderNumber,
        tire,
        quantity,
        total,
        withInstallation,
        installerName,
        lang
      })
    });

    console.log('✅ Email sent successfully:', data);
    return res.status(200).json({ success: true, id: data.id });

  } catch (error) {
    console.error('❌ Email send failed:', error);
    return res.status(500).json({ 
      error: 'Failed to send email',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Generate email HTML (bilingual support)
function generateEmailHTML(data: {
  name: string;
  orderNumber: string;
  tire: string;
  quantity: number;
  total: number;
  withInstallation: boolean;
  installerName?: string;
  lang: string;
}): string {
  const { name, orderNumber, tire, quantity, total, withInstallation, installerName, lang } = data;
  const isFrench = lang === 'fr';

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isFrench ? 'Confirmation de commande' : 'Order Confirmation'}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #ef4444; padding: 30px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 900;">
                GCI TIRE
              </h1>
              <p style="margin: 10px 0 0 0; color: #ffffff; font-size: 14px;">
                ${isFrench ? 'Expert en pneus' : 'Tire Experts'}
              </p>
            </td>
          </tr>

          <!-- Success Icon -->
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <div style="width: 80px; height: 80px; background-color: #10b981; border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 40px;">✓</span>
              </div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding: 0 40px 30px 40px; text-align: center;">
              <h2 style="margin: 0; color: #1f2937; font-size: 24px; font-weight: bold;">
                ${isFrench ? 'Commande confirmée!' : 'Order Confirmed!'}
              </h2>
              <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 16px;">
                ${isFrench 
                  ? `Merci ${name}, votre commande a été reçue.`
                  : `Thank you ${name}, your order has been received.`
                }
              </p>
            </td>
          </tr>

          <!-- Order Details -->
          <tr>
            <td style="padding: 0 40px 30px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 20px;">
                <tr>
                  <td style="padding-bottom: 15px;">
                    <strong style="color: #1f2937; font-size: 14px; text-transform: uppercase;">
                      ${isFrench ? 'Numéro de commande' : 'Order Number'}
                    </strong>
                    <p style="margin: 5px 0 0 0; color: #ef4444; font-size: 18px; font-weight: bold;">
                      ${orderNumber}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 15px; border-top: 1px solid #e5e7eb;">
                    <strong style="color: #1f2937; font-size: 14px;">
                      ${isFrench ? 'Produit' : 'Product'}:
                    </strong>
                    <p style="margin: 5px 0 0 0; color: #4b5563;">
                      ${quantity}x ${tire}
                    </p>
                  </td>
                </tr>
                ${withInstallation && installerName ? `
                <tr>
                  <td style="padding-top: 15px; border-top: 1px solid #e5e7eb;">
                    <strong style="color: #1f2937; font-size: 14px;">
                      ${isFrench ? 'Installation' : 'Installation'}:
                    </strong>
                    <p style="margin: 5px 0 0 0; color: #4b5563;">
                      ${installerName}
                    </p>
                  </td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding-top: 15px; border-top: 1px solid #e5e7eb;">
                    <strong style="color: #1f2937; font-size: 14px; text-transform: uppercase;">
                      ${isFrench ? 'Total' : 'Total'}:
                    </strong>
                    <p style="margin: 5px 0 0 0; color: #10b981; font-size: 20px; font-weight: bold;">
                      $${total.toFixed(2)} CAD
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Next Steps -->
          <tr>
            <td style="padding: 0 40px 30px 40px;">
              <h3 style="margin: 0 0 15px 0; color: #1f2937; font-size: 18px;">
                ${isFrench ? 'Prochaines étapes' : 'Next Steps'}:
              </h3>
              <ul style="margin: 0; padding-left: 20px; color: #4b5563; line-height: 1.8;">
                <li>
                  ${isFrench 
                    ? 'Vous recevrez un email de suivi une fois vos pneus expédiés.'
                    : 'You will receive a tracking email once your tires ship.'
                  }
                </li>
                ${withInstallation ? `
                <li>
                  ${isFrench 
                    ? 'Réservez votre rendez-vous d\'installation en ligne.'
                    : 'Book your installation appointment online.'
                  }
                </li>
                ` : ''}
                <li>
                  ${isFrench 
                    ? 'Contactez-nous si vous avez des questions.'
                    : 'Contact us if you have any questions.'
                  }
                </li>
              </ul>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 30px 40px; text-align: center;">
              <a href="https://www.gcitires.com" style="display: inline-block; background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-weight: bold; font-size: 16px;">
                ${isFrench ? 'Voir ma commande' : 'View My Order'}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9fafb; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
                ${isFrench ? 'Besoin d\'aide?' : 'Need help?'}
              </p>
              <p style="margin: 0; color: #4b5563; font-size: 14px;">
                <a href="mailto:support@gcitires.com" style="color: #ef4444; text-decoration: none;">support@gcitires.com</a> 
                ${isFrench ? 'ou' : 'or'} 
                <a href="tel:+18195550100" style="color: #ef4444; text-decoration: none;">(819) 555-0100</a>
              </p>
              <p style="margin: 20px 0 0 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} GCI Tire. ${isFrench ? 'Tous droits réservés.' : 'All rights reserved.'}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}
