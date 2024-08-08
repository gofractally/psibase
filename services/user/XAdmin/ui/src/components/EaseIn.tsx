import { ReactNode } from "react";
import { motion } from "framer-motion";

export const EaseIn = ({ children }: { children: ReactNode }) => (
    <motion.div
        initial={{ opacity: 0.0, y: 1 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{
            delay: 0.3,
            duration: 0.8,
            ease: "easeInOut",
        }}
        className="relative flex flex-col items-center justify-center gap-4 px-4"
    >
        {children}
    </motion.div>
);
