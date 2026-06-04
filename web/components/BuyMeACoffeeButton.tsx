import Image from "next/image";

export default function BuyMeACoffeeButton() {
  return (
    <a
      href="https://www.buymeacoffee.com/vbuch"
      className="inline-block opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Image
        src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=vbuch&button_colour=FFDD00&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff"
        alt="Buy me a coffee"
        width={235}
        height={50}
        unoptimized
      />
    </a>
  );
}
