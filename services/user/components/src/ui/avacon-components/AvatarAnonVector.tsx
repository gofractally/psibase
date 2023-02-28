import React from "react";

export const AvatarAnonVector = ({ hex }: { hex: boolean }) => (
    <svg
        width="19"
        height="22"
        viewBox="0 0 19 22"
        xmlns="http://www.w3.org/2000/svg"
        className={hex ? "absolute top-[19.44%] left-[22.34%]" : ""}
        style={{
            width: "57.0714285714286%",
            height: "72.2189752581336%",
        }}
    >
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.11909 10.7964C11.8299 10.7964 14.0275 8.5416 14.0275 5.76022C14.0275 2.97884 11.8299 0.724091 9.11909 0.724091C6.40822 0.724091 4.21064 2.97884 4.21064 5.76022C4.21064 8.5416 6.40822 10.7964 9.11909 10.7964ZM0.000976562 17.0204C3.32503 15.0926 5.02838 14.5759 9.11909 14.5759C13.2098 14.5759 14.9425 15.0926 18.2666 17.0204L16.3356 20.2306C15.751 21.2694 14.6708 21.9093 13.5017 21.9093H4.76593C3.59685 21.9093 2.51658 21.2694 1.93204 20.2306L0.000976562 17.0204Z"
            fill="currentColor"
        />
    </svg>
);

export default AvatarAnonVector;
